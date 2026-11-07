import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { messageOf, PaperBotError } from "./errors.ts";

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
  `
  ALTER TABLE papers ADD COLUMN authors TEXT;
  CREATE TABLE keeps (
    paper_id INTEGER PRIMARY KEY REFERENCES papers(id),
    scan_id INTEGER NOT NULL REFERENCES scans(id),
    briefing TEXT NOT NULL,
    dump TEXT,
    error TEXT,
    at TEXT NOT NULL,
    CHECK ((dump IS NULL) <> (error IS NULL))
  );
  `,
  `
  ALTER TABLE papers ADD COLUMN pdf TEXT;
  CREATE TABLE pending (
    id TEXT PRIMARY KEY,
    ids TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    authors TEXT,
    url TEXT NOT NULL,
    abstract TEXT NOT NULL,
    pdf TEXT,
    since TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE lab_posts (
    url TEXT PRIMARY KEY,
    read_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE papers ADD COLUMN author_ids TEXT;
  ALTER TABLE pending ADD COLUMN author_ids TEXT;
  ALTER TABLE picks ADD COLUMN groups TEXT;
  `,
];

export type ScanKind = "daily" | "weekly";
export type Outcome = "written" | "skipped" | "failed";

/** Per-source results of a Scan, such as `{ arxiv: { candidates: 412 } }` or `{ arxiv: { error: "…" } }`. */
export type SourceResults = Record<string, { candidates: number } | { error: string }>;

export type Settlement = { outcome: Outcome; reason?: string; briefing?: string; sources: SourceResults; at: Date };

/** `groups` names the Followed Groups that wrote a Pick chosen for them rather than by ranking. */
export type PickRecord = { candidate: Candidate; rank: number; why: string; summary: string; groups?: string[] };

export type ScanRow = {
  id: number;
  kind: ScanKind;
  date: string;
  outcome: Outcome | null;
  reason: string | null;
  briefing: string | null;
  sources: SourceResults | null;
};

/** A Scan that has settled: `at` is when. */
export type SettledScanRow = Omit<ScanRow, "outcome"> & { outcome: Outcome; at: string };

/** A Pick as a Keep needs it: the Paper's primary id, what the Scan stored about it, and why it was Picked. */
export type KeepablePick = {
  paper: string;
  title: string;
  authors: string[];
  url: string;
  abstract: string;
  interests: string[];
  why: string;
  summary: string;
};

/** A Paper Chris ticked Keep: `dump` once its Dump is written, else the `error` of the last try, retried next Scan. */
export type KeepRow = { paper: string; scanId: number; briefing: string; dump: string | null; error: string | null; at: string };

export type FailingKeep = { paper: string; title: string; error: string; at: string };

/**
 * A Pick as a Weekly Briefing lists it: `date` and `briefing` are those of the Daily Briefing it appeared in; `kept` once
 * its Keep's Dump is written, at `keptAt`. `groups` names the Followed Groups it was Picked for, empty for a ranked Pick.
 */
export type WeekPick = {
  paper: string;
  title: string;
  url: string;
  date: string;
  score: number;
  interests: string[];
  wildcard: boolean;
  groups: string[];
  why: string;
  summary: string;
  briefing: string;
  kept: boolean;
  keptAt: string | null;
};

export type PickRow = { scanId: number; paper: string; title: string; rank: number; interests: string[]; why: string; summary: string };

export type Store = {
  /**
   * The stored Papers the Candidate's ids belong to. When that is exactly one, the Candidate's other ids and author ids
   * join that Paper's; when it is more, nothing is merged.
   */
  matchKnown(candidate: Candidate): number[];
  /** The rankings of those of `papers` never Picked and first seen at or after `since`, in the order they were ranked. */
  unpickedRankings(papers: number[], since: Date): { candidate: Candidate; ranking: Ranking }[];
  /** `date` is the day a Daily Scan's Briefing is named for, or the Monday of the week a Weekly Scan covers. */
  startScan(kind: ScanKind, date: string, at: Date): number;
  /** Saves one ranking batch: each Candidate becomes a Paper with its ids and score, and leaves pending. */
  saveRankings(scanId: number, ranked: { candidate: Candidate; ranking: Ranking }[], at: Date): void;
  /**
   * The rankings Daily Scans saved since the last one that settled as written or skipped, in the order they were
   * ranked: the current Scan's, and those of failed Scans before it, so a Scan after a failed one reuses their scores.
   */
  unsettledRankings(): { candidate: Candidate; ranking: Ranking }[];
  /** Candidates a Scan could not rank, over the batch cap or in a failed batch, oldest first. */
  pending(): Candidate[];
  /** Adds Candidates to pending, or refreshes those already there. */
  addPending(candidates: Candidate[], at: Date): void;
  /** Records how the Scan ended, with its Picks, once its Briefing is settled. */
  settleScan(scanId: number, settlement: Settlement, picks: PickRecord[]): void;
  scans(): ScanRow[];
  /** The Scan of `kind` that settled last, or null before the first. */
  lastSettled(kind: ScanKind): SettledScanRow | null;
  picks(): PickRow[];
  /** The Picks of Daily Briefings dated `from` to `to` (`YYYY-MM-DD`, both included), by date and then rank. */
  weekPicks(from: string, to: string): WeekPick[];
  /** Briefings written by Scans of `kind`, or of either, dated `from` to `to` (`YYYY-MM-DD`, both included; no end when absent), oldest first. */
  writtenBriefings(dated: { kind?: ScanKind; from: string; to?: string }): string[];
  /** Every Paper ever Picked, once each, with what its first Pick said. */
  keepablePicks(): KeepablePick[];
  keeps(): KeepRow[];
  /** Keeps whose last try failed, oldest first: `at` is when it first failed. */
  failingKeeps(): FailingKeep[];
  /** Records a Keep's Dump, or the error of a failed try; a later try replaces it, except that a failure after a failure keeps the first one's time. */
  recordKeep(scanId: number, paper: string, briefing: string, kept: { dump: string } | { error: string }, at: Date): void;
  /** Forgets a failed Keep that can no longer be retried. */
  dropKeep(paper: string): void;
  /** The lab post URLs, of those given, that no Scan has read. */
  unreadPosts(urls: string[]): string[];
  markPostsRead(urls: string[], at: Date): void;
  /** The date of the last Daily Scan that didn't fail and read arXiv, if any. */
  arxivCoveredThrough(): string | undefined;
  /** Deletes the abstracts of Papers never Picked that were first seen before `before`; returns how many. */
  pruneAbstracts(before: Date): number;
  close(): void;
};

/** `existing` opens only a store that exists, never creating one; it upgrades an older store's schema but writes no data. */
export function openStore(path: string, { existing = false } = {}): Store {
  const db = existing ? openExisting(path) : openWritable(path);

  const findId = db.query<{ paper_id: number }, [string]>("SELECT paper_id FROM paper_ids WHERE id = ?");
  const paperOf = (candidate: Candidate): number | undefined => findId.get(primaryId(candidate))?.paper_id;

  const insertPaper = db.query<{ id: number }, [string, string, string | null, string | null, string, string | null, string, string]>(
    "INSERT INTO papers (title, url, authors, author_ids, abstract, pdf, source, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  );
  const authorIdsOf = db.query<{ author_ids: string | null }, [number]>("SELECT author_ids FROM papers WHERE id = ?");
  const setAuthorIds = db.query("UPDATE papers SET author_ids = ? WHERE id = ?");
  const insertId = db.query("INSERT INTO paper_ids (id, paper_id) VALUES (?, ?)");

  const matchKnown = db.transaction((candidate: Candidate): number[] => {
    const papers = [...new Set(candidate.ids.flatMap((id) => findId.get(id)?.paper_id ?? []))];
    const [paper] = papers;
    if (papers.length === 1 && paper !== undefined) {
      for (const id of candidate.ids) if (findId.get(id) === null) insertId.run(id, paper);
      const stored = parseList(authorIdsOf.get(paper)?.author_ids ?? null) ?? [];
      const authorIds = [...new Set([...stored, ...(candidate.authorIds ?? [])])];
      if (authorIds.length > stored.length) setAuthorIds.run(JSON.stringify(authorIds), paper);
    }
    return papers;
  });
  const insertScore = db.query("INSERT INTO scores (paper_id, scan_id, score, interests, why, wildcard) VALUES (?, ?, ?, ?, ?, ?)");
  const insertPick = db.query("INSERT INTO picks (scan_id, paper_id, rank, why, summary, groups) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertKeep = db.query(
    `INSERT INTO keeps (paper_id, scan_id, briefing, dump, error, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (paper_id) DO UPDATE SET scan_id = excluded.scan_id, briefing = excluded.briefing, dump = excluded.dump, error = excluded.error,
       at = CASE WHEN keeps.error IS NOT NULL AND excluded.error IS NOT NULL THEN keeps.at ELSE excluded.at END`,
  );
  const findPost = db.query<{ url: string }, [string]>("SELECT url FROM lab_posts WHERE url = ?");
  const insertPost = db.query("INSERT OR IGNORE INTO lab_posts (url, read_at) VALUES (?, ?)");
  const markPostsRead = db.transaction((urls: string[], at: string) => {
    for (const url of urls) insertPost.run(url, at);
  });
  const idsOf = db.query<{ id: string }, [number]>("SELECT id FROM paper_ids WHERE paper_id = ? ORDER BY rowid");
  const deletePending = db.query("DELETE FROM pending WHERE id = ?");
  const upsertPending = db.query(
    `INSERT INTO pending (id, ids, source, title, authors, author_ids, url, abstract, pdf, since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET ids = excluded.ids, title = excluded.title, authors = excluded.authors, author_ids = excluded.author_ids,
       url = excluded.url, abstract = excluded.abstract, pdf = excluded.pdf`,
  );
  const primaryIdOf = "(SELECT id FROM paper_ids WHERE paper_id = papers.id ORDER BY rowid LIMIT 1)";

  /** The stored rankings of the Papers `where` selects, in the order they were ranked. */
  const rankings = (where: string, params: (string | number)[] = []): { candidate: Candidate; ranking: Ranking }[] =>
    db
      .query<CandidateRow & { id: number; score: number; interests: string; why: string; wildcard: number }, (string | number)[]>(
        `SELECT papers.id, papers.source, papers.title, papers.authors, papers.author_ids, papers.url, coalesce(papers.abstract, '') AS abstract, papers.pdf,
           scores.score, scores.interests, scores.why, scores.wildcard
         FROM scores JOIN papers ON papers.id = scores.paper_id JOIN scans ON scans.id = scores.scan_id
         WHERE ${where}
         ORDER BY papers.id`,
      )
      .all(...params)
      .map(({ id, authors, author_ids, pdf, score, interests, why, wildcard, ...rest }) => ({
        candidate: { ...rest, ids: idsOf.all(id).map((row) => row.id), ...optional(authors, author_ids, pdf) },
        ranking: { score, interests: JSON.parse(interests) as string[], why, wildcard: wildcard === 1 },
      }));

  const saveRankings = db.transaction((scanId: number, ranked: { candidate: Candidate; ranking: Ranking }[], at: string) => {
    for (const { candidate, ranking } of ranked) {
      const paper = insertPaper.get(candidate.title, candidate.url, authorsJson(candidate), authorIdsJson(candidate), candidate.abstract, candidate.pdf ?? null, candidate.source, at);
      if (paper === null) throw new PaperBotError(`could not store "${candidate.title}"`);
      for (const id of candidate.ids) insertId.run(id, paper.id);
      insertScore.run(paper.id, scanId, ranking.score, JSON.stringify(ranking.interests), ranking.why, ranking.wildcard ? 1 : 0);
      for (const id of candidate.ids) deletePending.run(id);
    }
  });

  const addPending = db.transaction((candidates: Candidate[], at: string) => {
    for (const candidate of candidates) {
      upsertPending.run(
        primaryId(candidate),
        JSON.stringify(candidate.ids),
        candidate.source,
        candidate.title,
        authorsJson(candidate),
        authorIdsJson(candidate),
        candidate.url,
        candidate.abstract,
        candidate.pdf ?? null,
        at,
      );
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
      insertPick.run(scanId, paper, pick.rank, pick.why, pick.summary, pick.groups === undefined ? null : JSON.stringify(pick.groups));
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
    unsettledRankings: () =>
      rankings(
        `scans.kind = 'daily' AND scans.id > coalesce((SELECT max(id) FROM scans WHERE kind = 'daily' AND outcome IN ('written', 'skipped')), 0)`,
      ),
    unpickedRankings: (papers, since) =>
      papers.length === 0
        ? []
        : rankings(`papers.id IN (${papers.map(() => "?").join(", ")}) AND papers.first_seen >= ? AND papers.id NOT IN (SELECT paper_id FROM picks)`, [
            ...papers,
            since.toISOString(),
          ]),
    pending: () =>
      db
        .query<CandidateRow & { ids: string }, []>(
          "SELECT ids, source, title, authors, author_ids, url, abstract, pdf FROM pending ORDER BY rowid",
        )
        .all()
        .map(({ ids, authors, author_ids, pdf, ...rest }) => ({ ...rest, ids: JSON.parse(ids) as string[], ...optional(authors, author_ids, pdf) })),
    addPending: (candidates, at) => addPending(candidates, at.toISOString()),
    settleScan: (scanId, settlement, picks) => settleScan(scanId, settlement, picks),
    scans: () =>
      db
        .query<Omit<ScanRow, "sources"> & { sources: string | null }, []>("SELECT id, kind, date, outcome, reason, briefing, sources FROM scans ORDER BY id")
        .all()
        .map((row) => ({ ...row, sources: parseSources(row.sources) })),
    lastSettled(kind) {
      const row = db
        .query<Omit<SettledScanRow, "sources"> & { sources: string | null }, [ScanKind]>(
          `SELECT id, kind, date, outcome, reason, briefing, sources, settled_at AS at FROM scans
           WHERE kind = ? AND settled_at IS NOT NULL ORDER BY settled_at DESC, id DESC LIMIT 1`,
        )
        .get(kind);
      return row === null ? null : { ...row, sources: parseSources(row.sources) };
    },
    picks: () =>
      db
        .query<Omit<PickRow, "interests"> & { interests: string }, []>(
          `SELECT picks.scan_id AS scanId, ${primaryIdOf} AS paper,
             papers.title, picks.rank, scores.interests, picks.why, picks.summary
           FROM picks JOIN papers ON papers.id = picks.paper_id JOIN scores ON scores.paper_id = picks.paper_id
           ORDER BY picks.scan_id, picks.rank`,
        )
        .all()
        .map((row) => ({ ...row, interests: JSON.parse(row.interests) as string[] })),
    weekPicks: (from, to) =>
      db
        .query<Omit<WeekPick, "interests" | "wildcard" | "groups" | "kept"> & { interests: string; wildcard: number; groups: string | null }, [string, string]>(
          `SELECT ${primaryIdOf} AS paper, papers.title, papers.url, scans.date, scores.score, scores.interests, scores.wildcard, picks.groups,
             picks.why, picks.summary,
             scans.briefing, keeps.at AS keptAt
           FROM picks JOIN scans ON scans.id = picks.scan_id JOIN papers ON papers.id = picks.paper_id JOIN scores ON scores.paper_id = picks.paper_id
             LEFT JOIN keeps ON keeps.paper_id = picks.paper_id AND keeps.dump IS NOT NULL
           WHERE scans.kind = 'daily' AND scans.outcome = 'written' AND scans.date BETWEEN ? AND ?
           ORDER BY scans.date, scans.id, picks.rank`,
        )
        .all(from, to)
        .map((row) => ({
          ...row,
          interests: JSON.parse(row.interests) as string[],
          wildcard: row.wildcard === 1,
          groups: parseList(row.groups) ?? [],
          kept: row.keptAt !== null,
        })),
    writtenBriefings: ({ kind, from, to }) =>
      db
        .query<{ briefing: string }, [string, string | null, string | null]>(
          `SELECT briefing FROM scans WHERE briefing IS NOT NULL AND kind = coalesce(?3, kind) AND date >= ?1 AND date <= coalesce(?2, date)
           ORDER BY date, id`,
        )
        .all(from, to ?? null, kind ?? null)
        .map((row) => row.briefing),
    keepablePicks: () =>
      db
        .query<Omit<KeepablePick, "authors" | "interests"> & { authors: string | null; interests: string }, []>(
          `SELECT ${primaryIdOf} AS paper, papers.title, papers.authors, papers.url, coalesce(papers.abstract, '') AS abstract,
             scores.interests, picks.why, picks.summary
           FROM picks JOIN papers ON papers.id = picks.paper_id JOIN scores ON scores.paper_id = picks.paper_id
           WHERE picks.rowid = (SELECT min(rowid) FROM picks AS first WHERE first.paper_id = picks.paper_id)
           ORDER BY picks.scan_id, picks.rank`,
        )
        .all()
        .map((row) => ({
          ...row,
          authors: row.authors === null ? [] : (JSON.parse(row.authors) as string[]),
          interests: JSON.parse(row.interests) as string[],
        })),
    keeps: () =>
      db
        .query<KeepRow, []>(
          `SELECT ${primaryIdOf} AS paper, keeps.scan_id AS scanId, keeps.briefing, keeps.dump, keeps.error, keeps.at
           FROM keeps JOIN papers ON papers.id = keeps.paper_id ORDER BY keeps.at, keeps.paper_id`,
        )
        .all(),
    failingKeeps: () =>
      db
        .query<FailingKeep, []>(
          `SELECT ${primaryIdOf} AS paper, papers.title, keeps.error, keeps.at
           FROM keeps JOIN papers ON papers.id = keeps.paper_id WHERE keeps.error IS NOT NULL ORDER BY keeps.at, keeps.paper_id`,
        )
        .all(),
    recordKeep(scanId, paper, briefing, kept, at) {
      const paperId = findId.get(paper)?.paper_id;
      if (paperId === undefined) throw new PaperBotError(`Kept Paper ${paper} is not in the store`);
      upsertKeep.run(paperId, scanId, briefing, "dump" in kept ? kept.dump : null, "error" in kept ? kept.error : null, at.toISOString());
    },
    dropKeep(paper) {
      db.run("DELETE FROM keeps WHERE dump IS NULL AND paper_id = (SELECT paper_id FROM paper_ids WHERE id = ?)", [paper]);
    },
    unreadPosts: (urls) => urls.filter((url) => findPost.get(url) === null),
    markPostsRead: (urls, at) => markPostsRead(urls, at.toISOString()),
    arxivCoveredThrough: () =>
      db
        .query<{ date: string | null }, []>(
          `SELECT max(date) AS date FROM scans
           WHERE kind = 'daily' AND outcome IN ('written', 'skipped') AND json_extract(sources, '$.arxiv.candidates') IS NOT NULL`,
        )
        .get()?.date ?? undefined,
    pruneAbstracts: (before) =>
      db.run("UPDATE papers SET abstract = NULL WHERE abstract IS NOT NULL AND first_seen < ? AND id NOT IN (SELECT paper_id FROM picks)", [before.toISOString()])
        .changes,
    close: () => db.close(),
  };
}

/** A Candidate as `papers` and `pending` store it: `authors` and `author_ids` as JSON. */
type CandidateRow = Pick<Candidate, "source" | "title" | "url" | "abstract"> & { authors: string | null; author_ids: string | null; pdf: string | null };

const authorsJson = (candidate: Candidate): string | null => (candidate.authors === undefined ? null : JSON.stringify(candidate.authors));

const authorIdsJson = (candidate: Candidate): string | null => (candidate.authorIds === undefined ? null : JSON.stringify(candidate.authorIds));

const parseList = (json: string | null): string[] | undefined => (json === null ? undefined : (JSON.parse(json) as string[]));

const parseSources = (sources: string | null): SourceResults | null => (sources === null ? null : (JSON.parse(sources) as SourceResults));

/** A stored Candidate's optional fields, left out when the store holds null. */
function optional(authors: string | null, authorIds: string | null, pdf: string | null): Pick<Candidate, "authors" | "authorIds" | "pdf"> {
  return {
    ...(authors !== null && { authors: JSON.parse(authors) as string[] }),
    ...(authorIds !== null && { authorIds: JSON.parse(authorIds) as string[] }),
    ...(pdf !== null && { pdf }),
  };
}

function openWritable(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db, path);
  return db;
}

function openExisting(path: string): Database {
  let reader: Database;
  let version: number;
  try {
    reader = new Database(path, { readonly: true, strict: true });
    version = storeVersion(reader);
  } catch (error) {
    throw new PaperBotError(`cannot read the store at ${path}: ${messageOf(error)}`);
  }
  if (version === MIGRATIONS.length) return reader;
  reader.close();
  if (version > MIGRATIONS.length) throw newerStore(path, version);
  const db = new Database(path, { readwrite: true, create: false, strict: true });
  db.run("PRAGMA foreign_keys = ON");
  migrate(db, path);
  return db;
}

const storeVersion = (db: Database): number => db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;

const newerStore = (path: string, version: number): PaperBotError =>
  new PaperBotError(`${path} was written by a newer paper-bot (store version ${version})`);

function migrate(db: Database, path: string): void {
  const version = storeVersion(db);
  if (version > MIGRATIONS.length) throw newerStore(path, version);
  MIGRATIONS.slice(version).forEach((migration, i) => {
    db.transaction(() => {
      db.run(migration);
      db.run(`PRAGMA user_version = ${version + i + 1}`);
    })();
  });
}
