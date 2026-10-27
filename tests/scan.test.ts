import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../src/config.ts";
import type { Fetch } from "../src/http.ts";
import { INTERESTS_NOTE } from "../src/interests.ts";
import { dailyScan } from "../src/scan.ts";
import { openStore } from "../src/store.ts";
import {
  ARXIV_FEED,
  arxivFeedOf,
  arxivFetch,
  type FakeCommands,
  fakeCommands,
  fixture,
  idsIn,
  INTERESTS,
  MONDAY,
  sourcesFetch,
  tempDir,
  testConfig,
} from "./harness.ts";

const BRIEFING = "Research/Briefings/Daily/2026-10-26 Daily Briefing.md";
const TUESDAY = new Date("2026-10-27T12:00:00Z");

const PICKED = {
  "arxiv:2610.32109": { score: 8, interests: ["Context management in AI"] },
  "arxiv:2610.31679": { score: 9, interests: ["AI in higher education", "Context management in AI"] },
};

function sandbox() {
  const dir = tempDir();
  return { storePath: join(dir, "paper-bot.db"), logDir: join(dir, "logs") };
}

type ScanSetup = { commands: FakeCommands; storePath: string; logDir: string; fetch?: Fetch; config?: Config; at?: Date };

/** One Daily Scan against a store opened for it and closed after, as `paper-bot scan --daily` does. */
async function scan({ commands, storePath, logDir, fetch = arxivFetch(), config = testConfig(), at = MONDAY }: ScanSetup) {
  const store = openStore(storePath);
  try {
    return await dailyScan({ config, store, fetch, exec: commands.exec, clock: () => at, logDir });
  } finally {
    store.close();
  }
}

function stored(storePath: string) {
  const store = openStore(storePath);
  try {
    return { scans: store.scans(), picks: store.picks() };
  } finally {
    store.close();
  }
}

const commandNames = (commands: FakeCommands): string[] => commands.calls.map(({ argv }) => argv.slice(0, 2).join(" "));
const codexCalls = (commands: FakeCommands) => commands.calls.filter(({ argv }) => argv[0] === "codex");

describe("a Daily Scan", () => {
  test("writes a Daily Briefing of the Picks scoring 7 or above, best first", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir });

    // #then
    expect(commands.vault.get(BRIEFING)).toBe(`---
tags: [briefing, briefing/daily]
date: 2026-10-26
picks: 2
---

# Daily Briefing · Mon 26 Oct 2026

> Today leans toward context.

1. **[MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring](https://arxiv.org/abs/2610.31679)** · *AI in higher education · Context management in AI*
   **Why it's here:** Why arxiv:2610.31679.
   What arxiv:2610.31679 found.
   - [ ] Keep ^pick-2610-31679
2. **[Context or Knowledge: How LLMs Attribute Their Own Answers](https://arxiv.org/abs/2610.32109)** · *Context management in AI*
   **Why it's here:** Why arxiv:2610.32109.
   What arxiv:2610.32109 found.
   - [ ] Keep ^pick-2610-32109

2 candidates · arXiv 2
`);
  });

  test("records the Scan as written, with its Picks in rank order, once the Briefing is written", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir });

    // #then
    expect(stored(storePath)).toEqual({
      scans: [
        {
          id: 1,
          kind: "daily",
          date: "2026-10-26",
          outcome: "written",
          reason: null,
          briefing: BRIEFING,
          sources: {
            arxiv: { candidates: 2 },
            openalex: { candidates: 0 },
            eric: { candidates: 0 },
            pmlr: { candidates: 0 },
            jmlr: { candidates: 0 },
            hf: { candidates: 0 },
            deepmind: { candidates: 0 },
            anthropic: { candidates: 0 },
            openai: { candidates: 0 },
          },
        },
      ],
      picks: [
        {
          scanId: 1,
          paper: "arxiv:2610.31679",
          title: "MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring",
          rank: 1,
          interests: ["AI in higher education", "Context management in AI"],
          why: "Why arxiv:2610.31679.",
          summary: "What arxiv:2610.31679 found.",
        },
        {
          scanId: 1,
          paper: "arxiv:2610.32109",
          title: "Context or Knowledge: How LLMs Attribute Their Own Answers",
          rank: 2,
          interests: ["Context management in AI"],
          why: "Why arxiv:2610.32109.",
          summary: "What arxiv:2610.32109 found.",
        },
      ],
    });
  });

  test("picks at most 5, and none that matches no Interest", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const rankings = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`arxiv:2610.${30001 + i}`, { score: 10 - Math.floor(i / 2), interests: i === 0 ? [] : ["Context management in AI"] }]),
    );
    const commands = fakeCommands({ rankings });

    // #when
    await scan({ commands, storePath, logDir, fetch: arxivFetch(arxivFeedOf(7)) });

    // #then
    expect(stored(storePath).picks.map((pick) => pick.paper)).toEqual([
      "arxiv:2610.30002",
      "arxiv:2610.30003",
      "arxiv:2610.30004",
      "arxiv:2610.30005",
      "arxiv:2610.30006",
    ]);
  });

  test("is skipped with its reason, writing no Briefing, when no Candidate scores 7 or above", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: { "arxiv:2610.32109": { score: 6, interests: ["Context management in AI"] } } });

    // #when
    const result = await scan({ commands, storePath, logDir });

    // #then
    expect({ result, notes: [...commands.vault.keys()], commands: commandNames(commands), scans: stored(storePath).scans.map((row) => row.outcome) }).toEqual({
      result: { outcome: "skipped", reason: "no Candidate scored 7 or above" },
      notes: [INTERESTS_NOTE],
      commands: ["brain-dump show", "codex exec"],
      scans: ["skipped"],
    });
  });

  test("fails before any fetch when the Interests Note is missing", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ notes: {} });
    const fetch = arxivFetch();
    const reason = `brain-dump show failed (exit 1): brain-dump: ${INTERESTS_NOTE} is not a note in the write allowlist`;

    // #when
    const result = await scan({ commands, storePath, logDir, fetch });

    // #then
    expect({ result, fetched: fetch.urls, commands: commandNames(commands), scans: stored(storePath).scans.map(({ outcome, reason }) => ({ outcome, reason })) }).toEqual({
      result: { outcome: "failed", reason },
      fetched: [],
      commands: ["brain-dump show"],
      scans: [{ outcome: "failed", reason }],
    });
  });

  test("fails before any fetch when the Interests Note lists no Interests", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: "# Interests\n\n## Wildcards\nUp to 1 per Daily Briefing.\n" } });
    const fetch = arxivFetch();

    // #when
    const result = await scan({ commands, storePath, logDir, fetch });

    // #then
    expect({ result, fetched: fetch.urls }).toEqual({ result: { outcome: "failed", reason: `${INTERESTS_NOTE} lists no Interests` }, fetched: [] });
  });

  test("fails, recording why, when every source fails", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });
    const fetch = async () => new Response("down", { status: 503 });

    // #when
    await scan({ commands, storePath, logDir, fetch });

    // #then
    expect(stored(storePath).scans.map(({ outcome, reason, sources }) => ({ outcome, reason, sources }))).toEqual([
      {
        outcome: "failed",
        reason: "every source failed (arXiv: arXiv RSS answered 503; OpenAlex: OpenAlex answered 503; ERIC: ERIC answered 503; PMLR: PMLR answered 503; JMLR: JMLR answered 503)",
        sources: {
          arxiv: { error: "arXiv RSS answered 503" },
          openalex: { error: "OpenAlex answered 503" },
          eric: { error: "ERIC answered 503" },
          pmlr: { error: "PMLR answered 503" },
          jmlr: { error: "JMLR answered 503" },
          hf: { error: "HF daily papers answered 503" },
          deepmind: { error: "DeepMind answered 503 for https://deepmind.google/research/publications/" },
          anthropic: { error: "Anthropic answered 503 for https://transformer-circuits.pub/feed.xml" },
          openai: { error: "OpenAI answered 503" },
        },
      },
    ]);
  });

  test("still writes its Briefing when some sources fail, recording which", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });
    const working = arxivFetch();
    const fetch = async (url: string) => (url.startsWith("https://api.openalex.org/") ? new Response("busy", { status: 429 }) : working(url));

    // #when
    const result = await scan({ commands, storePath, logDir, fetch });

    // #then
    expect({ outcome: result.outcome, openalex: stored(storePath).scans[0]?.sources?.openalex }).toEqual({ outcome: "written", openalex: { error: "OpenAlex answered 429" } });
  });

  test("never ranks a Paper twice: the next Scan drops Papers already in the store", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    await scan({ commands: fakeCommands({ rankings: PICKED }), storePath, logDir });
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    const result = await scan({ commands, storePath, logDir, at: TUESDAY });

    // #then
    expect({ result, commands: commandNames(commands).filter((name) => name !== "brain-dump show") }).toEqual({
      result: { outcome: "skipped", reason: "no new Candidates" },
      commands: [],
    });
  });

  test("ranks in batches, one read-only codex exec each, with the pinned model and an output schema", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir, config: testConfig({ batch: { size: 1, cap: 20 } }) });

    // #then
    const codex = ["codex", "exec", "--ephemeral", "-s", "read-only", "--skip-git-repo-check", "-m", "gpt-test", "--output-schema", "<schema>", "-"];
    expect(codexCalls(commands).map(({ argv }) => argv.map((arg) => (arg.endsWith("rank-schema.json") ? "<schema>" : arg)))).toEqual([codex, codex]);
  });

  test("saves each batch's scores as it finishes, so a failed batch's Candidates are the only ones ranked again", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const config = testConfig({ batch: { size: 1, cap: 20 } });
    const lowScores = (stdin: string) => JSON.stringify({ rankings: idsIn(stdin).map((id) => ({ id, interests: [], score: 3, why: "", wildcard: false })) });
    let batches = 0;
    const secondBatchFails = fakeCommands({
      codex: (_argv, stdin) => {
        batches++;
        return batches === 2 ? { exitCode: 1, stdout: "", stderr: "usage limit" } : { exitCode: 0, stdout: lowScores(stdin), stderr: "" };
      },
    });
    await scan({ commands: secondBatchFails, storePath, logDir, config });
    const next = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands: next, storePath, logDir, config, at: TUESDAY });

    // #then
    expect(codexCalls(next).map(({ stdin }) => idsIn(stdin))).toEqual([["arxiv:2610.31679"]]);
  });

  test("fails when every ranking batch fails", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ codex: () => ({ exitCode: null, stdout: "", stderr: "" }) });

    // #when
    const result = await scan({ commands, storePath, logDir });

    // #then
    expect(result).toEqual({ outcome: "failed", reason: "every ranking batch failed" });
  });

  test("writes the prose with claude -p, with no tools, against a JSON schema", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir });

    // #then
    const claude = commands.calls.find(({ argv }) => argv[0] === "claude");
    expect(claude?.argv.slice(0, -1)).toEqual([
      "claude",
      "-p",
      "--no-session-persistence",
      "--model",
      "claude-test",
      "--tools",
      "",
      "--strict-mcp-config",
      "--safe-mode",
      "--output-format",
      "json",
      "--json-schema",
    ]);
  });

  test("fails, writing no Briefing and recording no Picks, when claude reports an error", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const envelope = { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" };
    const commands = fakeCommands({ rankings: PICKED, claude: () => ({ exitCode: 0, stdout: JSON.stringify(envelope), stderr: "" }) });

    // #when
    const result = await scan({ commands, storePath, logDir });

    // #then
    expect({ result, briefing: commands.vault.has(BRIEFING), picks: stored(storePath).picks }).toEqual({
      result: { outcome: "failed", reason: "claude -p failed: Not logged in · Please run /login" },
      briefing: false,
      picks: [],
    });
  });

  test("fails, recording no Picks, when brain-dump refuses the Briefing", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED, notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: "already here" } });

    // #when
    const result = await scan({ commands, storePath, logDir });

    // #then
    expect({ result, picks: stored(storePath).picks }).toEqual({
      result: { outcome: "failed", reason: `brain-dump write-briefing failed (exit 1): brain-dump: ${BRIEFING} already exists` },
      picks: [],
    });
  });

  test("logs the Scan to <date>-daily.log", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir });

    // #then
    const lines = readFileSync(join(logDir, "2026-10-26-daily.log"), "utf8").trim().split("\n");
    expect({ files: readdirSync(logDir), last: lines.at(-1)?.replace(/^\S+ /, "") }).toEqual({ files: ["2026-10-26-daily.log"], last: "Daily Scan written" });
  });
});

describe("a Daily Scan reading the whole Interests Note", () => {
  const VENUES_AND_AVOID = `## Context management in AI
How agents choose, compress and carry context.

- Venues: ACL, EMNLP
- Avoid: pure long-context architecture papers; benchmark-only papers

## Wildcards
Up to 1 per Daily Briefing. Anything surprising.
`;

  test("gives the ranker each Interest's Venues and Avoid list", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED, notes: { [INTERESTS_NOTE]: VENUES_AND_AVOID } });

    // #when
    await scan({ commands, storePath, logDir, config: testConfig({ venues: { ACL: "S4363608652", EMNLP: "S4363608991" } }) });

    // #then
    expect(codexCalls(commands)[0]?.stdin).toContain(`## Context management in AI
How agents choose, compress and carry context.
Venues: ACL, EMNLP
Avoid: pure long-context architecture papers; benchmark-only papers`);
  });

  test("adds flagged Wildcards scoring 8 or above after the Picks, up to the cap, marked in the Briefing", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({
      rankings: {
        "arxiv:2610.30001": { score: 7, interests: ["Context management in AI"] },
        "arxiv:2610.30002": { score: 7, wildcard: true },
        "arxiv:2610.30003": { score: 8, wildcard: true },
        "arxiv:2610.30004": { score: 9, wildcard: true },
        "arxiv:2610.30005": { score: 10 },
      },
    });

    // #when
    await scan({ commands, storePath, logDir, fetch: arxivFetch(arxivFeedOf(5)) });

    // #then
    const lines = commands.vault.get(BRIEFING)?.split("\n") ?? [];
    expect({ picks: stored(storePath).picks.map((pick) => pick.paper), titles: lines.filter((line) => /^\d+\. /.test(line)) }).toEqual({
      picks: ["arxiv:2610.30001", "arxiv:2610.30004"],
      titles: ["1. **[Paper 1](https://arxiv.org/abs/2610.30001)** · *Context management in AI*", "2. **[Paper 4](https://arxiv.org/abs/2610.30004)** · *Wildcard*"],
    });
  });

  test("writes a Briefing of Wildcards alone when no Candidate matches an Interest", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: { "arxiv:2610.32109": { score: 9, wildcard: true } } });

    // #when
    const result = await scan({ commands, storePath, logDir });

    // #then
    expect({ outcome: result.outcome, picks: stored(storePath).picks.map((pick) => pick.paper) }).toEqual({ outcome: "written", picks: ["arxiv:2610.32109"] });
  });

  test("picks no Wildcards when the note has no Wildcards section", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const note = "## Context management in AI\nHow agents choose, compress and carry context.\n";
    const commands = fakeCommands({ rankings: { ...PICKED, "arxiv:2610.32109": { score: 9, wildcard: true } }, notes: { [INTERESTS_NOTE]: note } });

    // #when
    await scan({ commands, storePath, logDir });

    // #then
    expect(stored(storePath).picks.map((pick) => pick.paper)).toEqual(["arxiv:2610.31679"]);
  });

  test("still runs with an unreadable bullet and an unknown Venue, naming them on an Interests Note issues line", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const note = `${VENUES_AND_AVOID}\n## AI in higher education\nHow AI changes university teaching.\n\n- Priority: high\n`;
    const commands = fakeCommands({ rankings: PICKED, notes: { [INTERESTS_NOTE]: note } });

    // #when
    await scan({ commands, storePath, logDir, config: testConfig({ venues: { ACL: "S4363608652" } }) });

    // #then
    expect(commands.vault.get(BRIEFING)?.split("\n\n").slice(-2)).toEqual([
      "2 candidates · arXiv 2",
      'Interests Note issues: unknown Venue under Context management in AI: "EMNLP"; unreadable bullet under AI in higher education: "- Priority: high"\n',
    ]);
  });
});

describe("a Daily Scan across sources", () => {
  const ALL_SOURCES = {
    "https://rss.arxiv.org/": ARXIV_FEED,
    "https://api.openalex.org/": fixture("openalex-works.json"),
    "https://api.ies.ed.gov/eric/": fixture("eric.json"),
    "https://proceedings.mlr.press/feed.xml": fixture("pmlr-root.xml"),
    "https://proceedings.mlr.press/v306/assets/rss/feed.xml": fixture("pmlr-v306.xml"),
    "https://www.jmlr.org/": fixture("jmlr.xml"),
  };
  const WEDNESDAY = new Date("2026-10-28T12:00:00Z");
  const openalexServing = (...works: object[]) => sourcesFetch({ "https://api.openalex.org/": JSON.stringify({ meta: { next_cursor: null }, results: works }) });
  const work = (id: string, extra: object = {}) => ({ id: `https://openalex.org/${id}`, title: `Work ${id}`, abstract_inverted_index: { Text: [0] }, ...extra });
  const rankedIds = (commands: FakeCommands) => codexCalls(commands).flatMap(({ stdin }) => idsIn(stdin));

  test("ranks every source's Candidates once, a Paper two sources share only once", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir, fetch: sourcesFetch(ALL_SOURCES) });

    // #then
    expect(rankedIds(commands)).toEqual([
      "arxiv:2610.32109",
      "arxiv:2610.31679",
      "doi:10.1145/3772318.3790001",
      "openalex:W4416000003",
      "doi:10.1080/03075079.2026.2290001",
      "eric:ED670002",
      "url:https://proceedings.mlr.press/v306/lee26a.html",
      "url:https://proceedings.mlr.press/v306/ono26b.html",
      "url:https://www.jmlr.org/papers/v27/25-0101.html",
    ]);
  });

  test("counts the ranked Candidates per source in the footer", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir, fetch: sourcesFetch(ALL_SOURCES) });

    // #then
    expect(commands.vault.get(BRIEFING)?.trim().split("\n").at(-1)).toBe("9 candidates · arXiv 2 · OpenAlex 2 · ERIC 2 · PMLR 2 · JMLR 1");
  });

  test("drops a Candidate from another source that matches a stored id, and its new ids join that Paper", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    await scan({ commands: fakeCommands({ rankings: PICKED }), storePath, logDir });
    const preprint = work("W4416000002", { doi: "https://doi.org/10.48550/arXiv.2610.32109" });
    await scan({ commands: fakeCommands(), storePath, logDir, at: TUESDAY, fetch: openalexServing(preprint) });
    const commands = fakeCommands();

    // #when
    const result = await scan({ commands, storePath, logDir, at: WEDNESDAY, fetch: openalexServing(work("W4416000002")) });

    // #then
    expect({ result, ranked: rankedIds(commands) }).toEqual({ result: { outcome: "skipped", reason: "no new Candidates" }, ranked: [] });
  });

  test("logs a Candidate whose ids match two stored Papers, and merges none of its ids", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    await scan({ commands: fakeCommands({ rankings: PICKED }), storePath, logDir });
    const bridging = work("W9", { doi: "https://doi.org/10.48550/arXiv.2610.32109", locations: [{ landing_page_url: "https://arxiv.org/abs/2610.31679" }] });
    await scan({ commands: fakeCommands(), storePath, logDir, at: TUESDAY, fetch: openalexServing(bridging) });
    const commands = fakeCommands();

    // #when
    await scan({ commands, storePath, logDir, at: WEDNESDAY, fetch: openalexServing(work("W9")) });

    // #then
    const log = readFileSync(join(logDir, "2026-10-27-daily.log"), "utf8");
    expect({ logged: log.includes('"Work W9" (arxiv:2610.32109) matches 2 stored Papers; its ids were not merged'), ranked: rankedIds(commands) }).toEqual({
      logged: true,
      ranked: ["openalex:W9"],
    });
  });

  test("leaves out, and logs, a Candidate whose ids match two others fetched in the same Scan", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const bridging = work("W9", { doi: "https://doi.org/10.48550/arXiv.2610.32109", locations: [{ landing_page_url: "https://arxiv.org/abs/2610.31679" }] });
    const fetch = sourcesFetch({ "https://rss.arxiv.org/": ARXIV_FEED, "https://api.openalex.org/": JSON.stringify({ meta: { next_cursor: null }, results: [bridging] }) });
    const commands = fakeCommands({ rankings: PICKED });

    // #when
    await scan({ commands, storePath, logDir, fetch });

    // #then
    const log = readFileSync(join(logDir, "2026-10-26-daily.log"), "utf8");
    expect({ logged: log.includes('"Work W9" (arxiv:2610.32109) matches two other Candidates; its ids were not merged'), ranked: rankedIds(commands) }).toEqual({
      logged: true,
      ranked: ["arxiv:2610.32109", "arxiv:2610.31679"],
    });
  });

  test("ranks a Candidate with no abstract but never Picks it", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const lee = "url:https://proceedings.mlr.press/v306/lee26a.html";
    const ono = "url:https://proceedings.mlr.press/v306/ono26b.html";
    const interests = ["Context management in AI"];
    const commands = fakeCommands({ rankings: { [lee]: { score: 8, interests }, [ono]: { score: 10, interests } } });
    const fetch = sourcesFetch({ "https://proceedings.mlr.press/feed.xml": fixture("pmlr-root.xml"), "https://proceedings.mlr.press/v306/assets/rss/feed.xml": fixture("pmlr-v306.xml") });

    // #when
    await scan({ commands, storePath, logDir, fetch });

    // #then
    expect({ ranked: rankedIds(commands), picks: stored(storePath).picks.map((pick) => pick.paper) }).toEqual({ ranked: [lee, ono], picks: [lee] });
  });

  test("tells the ranker a Candidate has no abstract", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands();
    const fetch = sourcesFetch({ "https://proceedings.mlr.press/feed.xml": fixture("pmlr-root.xml"), "https://proceedings.mlr.press/v306/assets/rss/feed.xml": fixture("pmlr-v306.xml") });

    // #when
    await scan({ commands, storePath, logDir, fetch });

    // #then
    expect(codexCalls(commands)[0]?.stdin).toContain("title: Sparse World Models\nabstract: none\n");
  });

  test("asks OpenAlex for the works of the Venues the Interests Note watches", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const note = "## Context management in AI\nHow agents carry context.\n\n- Venues: ACL, EMNLP\n";
    const commands = fakeCommands({ rankings: PICKED, notes: { [INTERESTS_NOTE]: note } });
    const fetch = arxivFetch();
    const config = testConfig({ venues: { ACL: "S4363608652", EMNLP: "S4363608991", CHI: "S4363607743" } });

    // #when
    await scan({ commands, storePath, logDir, fetch, config });

    // #then
    const filters = fetch.urls.filter((url) => url.startsWith("https://api.openalex.org/")).map((url) => new URL(url).searchParams.get("filter"));
    expect(filters).toContain("primary_location.source.id:S4363608652|S4363608991,publication_year:2026|2025");
  });
});

describe("a Daily Scan with pointers", () => {
  const candidateIn = (prompt: string | undefined, id: string): string | undefined => prompt?.split("\n\n").find((block) => block.startsWith(`id: ${id}\n`));
  const withHf = () => sourcesFetch({ "https://rss.arxiv.org/": ARXIV_FEED, "https://huggingface.co/": fixture("hf-daily-papers.json") });

  test("tells the ranker, as text, that a Candidate is on HF daily papers", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands();

    // #when
    await scan({ commands, storePath, logDir, fetch: withHf() });

    // #then
    expect(candidateIn(codexCalls(commands)[0]?.stdin, "arxiv:2610.32109")).toEndWith("\nsignals: on HF daily papers");
  });

  test("adds no Candidate for a Paper HF lists that no source fetched", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands();

    // #when
    await scan({ commands, storePath, logDir, fetch: withHf() });

    // #then
    expect(codexCalls(commands).flatMap(({ stdin }) => idsIn(stdin))).toEqual(["arxiv:2610.32109", "arxiv:2610.31679"]);
  });

  test("tells the ranker OpenAI announced a Candidate whose title an OpenAI research post shares, whatever its case", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const commands = fakeCommands();
    const fetch = sourcesFetch({ "https://rss.arxiv.org/": ARXIV_FEED, "https://openai.com/": fixture("openai-news.xml") });

    // #when
    await scan({ commands, storePath, logDir, fetch });

    // #then
    expect(candidateIn(codexCalls(commands)[0]?.stdin, "arxiv:2610.32109")).toEndWith("\nsignals: announced by OpenAI");
  });
});
