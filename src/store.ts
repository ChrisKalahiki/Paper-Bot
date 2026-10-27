import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { PaperBotError } from "./errors.ts";

/** Migration n takes the store from `user_version` n to n + 1. Never edit one that has shipped; add another. */
const MIGRATIONS = [
  `
  CREATE TABLE papers (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    abstract TEXT,
    source TEXT NOT NULL,
    first_seen TEXT NOT NULL
  );
  CREATE TABLE paper_ids (
    id TEXT PRIMARY KEY,
    paper_id INTEGER NOT NULL REFERENCES papers(id)
  );
  CREATE INDEX paper_ids_by_paper ON paper_ids(paper_id);
  CREATE TABLE scans (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
    date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    settled_at TEXT,
    outcome TEXT CHECK (outcome IN ('written', 'skipped', 'failed')),
    reason TEXT,
    briefing TEXT,
    sources TEXT
  );
  CREATE TABLE scores (
    paper_id INTEGER PRIMARY KEY REFERENCES papers(id),
    scan_id INTEGER NOT NULL REFERENCES scans(id),
    score INTEGER NOT NULL,
    interests TEXT NOT NULL,
    why TEXT NOT NULL,
    wildcard INTEGER NOT NULL
  );
  CREATE TABLE picks (
    scan_id INTEGER NOT NULL REFERENCES scans(id),
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    rank INTEGER NOT NULL,
    why TEXT NOT NULL,
    summary TEXT NOT NULL,
    PRIMARY KEY (scan_id, paper_id)
  );
  `,
];

export type ScanKind = "daily" | "weekly";
export type Outcome = "written" | "skipped" | "failed";

/** Per-source results of a Scan, such as `{ arxiv: { candidates: 412 } }` or `{ arxiv: { error: "…" } }`. */
export type SourceResults = Record<string, { candidates: number } | { error: string }>;

export type Settlement = { outcome: Outcome; reason?: string; briefing?: string; sources: SourceResults; at: Date };

export type PickRecord = { candidate: Candidate; rank: number; why: string; summary: string };

export type ScanRow = {
  id: number;
  kind: ScanKind;
  date: string;
  outcome: Outcome | null;
  reason: string | null;
  briefing: string | null;
  sources: SourceResults | null;
};

export type PickRow = { scanId: number; paper: string; title: string; rank: number; interests: string[]; why: string; summary: string };

export type Store = {
  /**
   * The stored Papers the Candidate's ids belong to. When that is exactly one, the Candidate's other ids join its id
   * set; when it is more, nothing is merged.
   */
  matchKnown(candidate: Candidate): number[];
  startScan(kind: ScanKind, date: string, at: Date): number;
  /** Saves one ranking batch: each Candidate becomes a Paper with its ids and score. */
  saveRankings(scanId: number, ranked: { candidate: Candidate; ranking: Ranking }[], at: Date): void;
  /** Records how the Scan ended, with its Picks, once its Briefing is settled. */
  settleScan(scanId: number, settlement: Settlement, picks: PickRecord[]): void;
  scans(): ScanRow[];
  picks(): PickRow[];
  close(): void;
};

export function openStore(path: string): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db, path);

  const findId = db.query<{ paper_id: number }, [string]>("SELECT paper_id FROM paper_ids WHERE id = ?");
  const paperOf = (candidate: Candidate): number | undefined => findId.get(primaryId(candidate))?.paper_id;

  const insertPaper = db.query<{ id: number }, [string, string, string, string, string]>(
    "INSERT INTO papers (title, url, abstract, source, first_seen) VALUES (?, ?, ?, ?, ?) RETURNING id",
  );
  const insertId = db.query("INSERT INTO paper_ids (id, paper_id) VALUES (?, ?)");

  const matchKnown = db.transaction((candidate: Candidate): number[] => {
    const papers = [...new Set(candidate.ids.flatMap((id) => findId.get(id)?.paper_id ?? []))];
    const [paper] = papers;
    if (papers.length === 1 && paper !== undefined) {
      for (const id of candidate.ids) if (findId.get(id) === null) insertId.run(id, paper);
    }
    return papers;
  });
  const insertScore = db.query("INSERT INTO scores (paper_id, scan_id, score, interests, why, wildcard) VALUES (?, ?, ?, ?, ?, ?)");
  const insertPick = db.query("INSERT INTO picks (scan_id, paper_id, rank, why, summary) VALUES (?, ?, ?, ?, ?)");

  const saveRankings = db.transaction((scanId: number, ranked: { candidate: Candidate; ranking: Ranking }[], at: string) => {
    for (const { candidate, ranking } of ranked) {
      const paper = insertPaper.get(candidate.title, candidate.url, candidate.abstract, candidate.source, at);
      if (paper === null) throw new PaperBotError(`could not store "${candidate.title}"`);
      for (const id of candidate.ids) insertId.run(id, paper.id);
      insertScore.run(paper.id, scanId, ranking.score, JSON.stringify(ranking.interests), ranking.why, ranking.wildcard ? 1 : 0);
    }
  });

  const settleScan = db.transaction((scanId: number, settlement: Settlement, picks: PickRecord[]) => {
    db.run("UPDATE scans SET settled_at = ?, outcome = ?, reason = ?, briefing = ?, sources = ? WHERE id = ?", [
      settlement.at.toISOString(),
      settlement.outcome,
      settlement.reason ?? null,
      settlement.briefing ?? null,
      JSON.stringify(settlement.sources),
      scanId,
    ]);
    for (const pick of picks) {
      const paper = paperOf(pick.candidate);
      if (paper === undefined) throw new PaperBotError(`Pick "${pick.candidate.title}" was never ranked`);
      insertPick.run(scanId, paper, pick.rank, pick.why, pick.summary);
    }
  });

  return {
    matchKnown: (candidate) => matchKnown(candidate),
    startScan(kind, date, at) {
      const row = db
        .query<{ id: number }, [string, string, string]>("INSERT INTO scans (kind, date, started_at) VALUES (?, ?, ?) RETURNING id")
        .get(kind, date, at.toISOString());
      if (row === null) throw new PaperBotError("could not record the Scan");
      return row.id;
    },
    saveRankings: (scanId, ranked, at) => saveRankings(scanId, ranked, at.toISOString()),
    settleScan: (scanId, settlement, picks) => settleScan(scanId, settlement, picks),
    scans: () =>
      db
        .query<Omit<ScanRow, "sources"> & { sources: string | null }, []>("SELECT id, kind, date, outcome, reason, briefing, sources FROM scans ORDER BY id")
        .all()
        .map((row) => ({ ...row, sources: row.sources === null ? null : (JSON.parse(row.sources) as SourceResults) })),
    picks: () =>
      db
        .query<Omit<PickRow, "interests"> & { interests: string }, []>(
          `SELECT picks.scan_id AS scanId, (SELECT id FROM paper_ids WHERE paper_id = papers.id ORDER BY rowid LIMIT 1) AS paper,
             papers.title, picks.rank, scores.interests, picks.why, picks.summary
           FROM picks JOIN papers ON papers.id = picks.paper_id JOIN scores ON scores.paper_id = picks.paper_id
           ORDER BY picks.scan_id, picks.rank`,
        )
        .all()
        .map((row) => ({ ...row, interests: JSON.parse(row.interests) as string[] })),
    close: () => db.close(),
  };
}

function migrate(db: Database, path: string): void {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (version > MIGRATIONS.length) throw new PaperBotError(`${path} was written by a newer paper-bot (store version ${version})`);
  MIGRATIONS.slice(version).forEach((migration, i) => {
    db.transaction(() => {
      db.run(migration);
      db.run(`PRAGMA user_version = ${version + i + 1}`);
    })();
  });
}
