import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Fetch } from "../src/http.ts";
import { INTERESTS_NOTE } from "../src/interests.ts";
import { picksReport } from "../src/picks.ts";
import { dailyScan } from "../src/scan.ts";
import { scheduledScans } from "../src/schedule.ts";
import { openStore } from "../src/store.ts";
import { arxivFeedOf, arxivFetch, type FakeCommands, fakeCommands, fakeSleep, INTERESTS, MONDAY, sourcesFetch, tempDir, testConfig } from "./harness.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const USAGE = "usage: paper-bot scan [--daily | --weekly]\n       paper-bot picks --json";
const TUESDAY = new Date("2026-10-27T12:00:00Z");
const NEXT_MONDAY = new Date("2026-11-02T12:00:00Z");
const MONDAY_BRIEFING = "Research/Briefings/Daily/2026-10-26 Daily Briefing.md";
const TUESDAY_BRIEFING = "Research/Briefings/Daily/2026-10-27 Daily Briefing.md";
const context = ["Context management in AI"];

const RANKINGS = {
  "arxiv:2610.31679": { score: 9, interests: ["AI in higher education", ...context] },
  "arxiv:2610.32109": { score: 8, interests: context },
  "arxiv:2610.30001": { score: 9, wildcard: true },
};

function sandbox() {
  const dir = tempDir();
  return { storePath: join(dir, "paper-bot.db"), logDir: join(dir, "logs") };
}

type Sandbox = ReturnType<typeof sandbox>;

function report({ storePath }: Sandbox, at: Date) {
  const store = openStore(storePath, { readonly: true });
  try {
    return picksReport(store, at);
  } finally {
    store.close();
  }
}

async function daily({ storePath, logDir }: Sandbox, commands: FakeCommands, at: Date, fetch: Fetch = arxivFetch()) {
  const store = openStore(storePath);
  try {
    return await dailyScan({ config: testConfig(), store, fetch, exec: commands.exec, clock: () => at, logDir, sleep: fakeSleep() });
  } finally {
    store.close();
  }
}

/** `paper-bot scan` at `at`, when every source has nothing new. */
async function scheduled({ storePath, logDir }: Sandbox, commands: FakeCommands, at: Date) {
  const store = openStore(storePath);
  try {
    return await scheduledScans({ config: testConfig(), store, fetch: sourcesFetch(), exec: commands.exec, clock: () => at, logDir, sleep: fakeSleep() });
  } finally {
    store.close();
  }
}

/** Monday's Daily Briefing of two Picks, then Tuesday's of a Wildcard, the Scan that keeps Monday's first Pick. */
async function weekOfPicks(box: Sandbox): Promise<void> {
  const monday = fakeCommands({ rankings: RANKINGS });
  await daily(box, monday, MONDAY);
  const ticked = (monday.vault.get(MONDAY_BRIEFING) ?? "").replace("- [ ] Keep ^pick-2610-31679", "- [x] Keep ^pick-2610-31679");
  const tuesday = fakeCommands({ rankings: RANKINGS, notes: { [INTERESTS_NOTE]: INTERESTS, [MONDAY_BRIEFING]: ticked } });
  await daily(box, tuesday, TUESDAY, arxivFetch(arxivFeedOf(1)));
}

function emptyStore(box: Sandbox): void {
  openStore(box.storePath).close();
}

describe("paper-bot picks --json", () => {
  test("before any Scan has no Scans, failing Keeps or Picks", () => {
    // #given
    const box = sandbox();
    emptyStore(box);

    // #when
    const json = report(box, MONDAY);

    // #then
    expect(json).toEqual({ scans: { daily: null, weekly: null }, keeps: { failing: [] }, week: "2026-W44", picks: [] });
  });

  test("lists this week's Picks by day and rank, with their Wildcards, Keeps and Briefings", async () => {
    // #given
    const box = sandbox();
    await weekOfPicks(box);

    // #when
    const { picks } = report(box, TUESDAY);

    // #then
    expect(picks).toEqual([
      {
        id: "arxiv:2610.31679",
        title: "MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring",
        url: "https://arxiv.org/abs/2610.31679",
        date: "2026-10-26",
        interests: ["AI in higher education", "Context management in AI"],
        wildcard: false,
        why: "Why arxiv:2610.31679.",
        kept: true,
        keptAt: "2026-10-27T12:00:00.000Z",
        briefing: MONDAY_BRIEFING,
      },
      {
        id: "arxiv:2610.32109",
        title: "Context or Knowledge: How LLMs Attribute Their Own Answers",
        url: "https://arxiv.org/abs/2610.32109",
        date: "2026-10-26",
        interests: ["Context management in AI"],
        wildcard: false,
        why: "Why arxiv:2610.32109.",
        kept: false,
        keptAt: null,
        briefing: MONDAY_BRIEFING,
      },
      {
        id: "arxiv:2610.30001",
        title: "Paper 1",
        url: "https://arxiv.org/abs/2610.30001",
        date: "2026-10-27",
        interests: [],
        wildcard: true,
        why: "Why arxiv:2610.30001.",
        kept: false,
        keptAt: null,
        briefing: TUESDAY_BRIEFING,
      },
    ]);
  });

  test("gives the latest Daily Scan with each source, naming the error of one that failed", async () => {
    // #given
    const box = sandbox();
    const arxiv = arxivFetch();
    const ericDown: Fetch = async (url) => (url.startsWith("https://api.ies.ed.gov/eric/") ? new Response("down", { status: 503 }) : arxiv(url));
    await daily(box, fakeCommands({ rankings: RANKINGS }), MONDAY, ericDown);

    // #when
    const { scans } = report(box, MONDAY);

    // #then
    expect(scans.daily).toEqual({
      at: "2026-10-26T12:00:00.000Z",
      date: "2026-10-26",
      outcome: "briefing",
      reason: "degraded: ERIC failed: ERIC answered 503",
      sources: [
        { name: "arxiv", ok: true, error: null },
        { name: "openalex", ok: true, error: null },
        { name: "eric", ok: false, error: "ERIC answered 503" },
        { name: "pmlr", ok: true, error: null },
        { name: "jmlr", ok: true, error: null },
        { name: "hf", ok: true, error: null },
        { name: "deepmind", ok: true, error: null },
        { name: "anthropic", ok: true, error: null },
        { name: "openai", ok: true, error: null },
      ],
    });
  });

  test("gives the latest Weekly Scan by the ISO week it covers", async () => {
    // #given
    const box = sandbox();
    await weekOfPicks(box);
    await scheduled(box, fakeCommands({ rankings: RANKINGS }), NEXT_MONDAY);

    // #when
    const { scans } = report(box, NEXT_MONDAY);

    // #then
    expect(scans.weekly).toEqual({ at: "2026-11-02T12:00:00.000Z", week: "2026-W44", outcome: "briefing", reason: null });
  });

  test("gives a failed Scan with its reason", async () => {
    // #given
    const box = sandbox();
    const unreachable = fakeCommands({ brainDump: () => ({ exitCode: 1, stdout: "", stderr: "brain-dump: Vault not found at /nowhere\n" }) });
    await daily(box, unreachable, MONDAY);

    // #when
    const { scans } = report(box, MONDAY);

    // #then
    expect(scans.daily).toEqual({
      at: "2026-10-26T12:00:00.000Z",
      date: "2026-10-26",
      outcome: "failed",
      reason: "brain-dump show failed (exit 1): brain-dump: Vault not found at /nowhere",
      sources: [],
    });
  });

  test("lists a Keep whose Dump could not be written as failing, with its error", async () => {
    // #given
    const box = sandbox();
    const monday = fakeCommands({ rankings: RANKINGS });
    await daily(box, monday, MONDAY);
    const ticked = (monday.vault.get(MONDAY_BRIEFING) ?? "").replace("- [ ] Keep ^pick-2610-32109", "- [x] Keep ^pick-2610-32109");
    const refused = fakeCommands({
      notes: { [INTERESTS_NOTE]: INTERESTS, [MONDAY_BRIEFING]: ticked },
      writeDump: () => ({ exitCode: 1, stdout: "", stderr: "brain-dump: Vault not found at /nowhere\n" }),
    });
    await daily(box, refused, TUESDAY, arxivFetch(arxivFeedOf(0)));

    // #when
    const { keeps } = report(box, TUESDAY);

    // #then
    expect(keeps.failing).toEqual([
      {
        id: "arxiv:2610.32109",
        title: "Context or Knowledge: How LLMs Attribute Their Own Answers",
        error: "brain-dump write-dump failed (exit 1): brain-dump: Vault not found at /nowhere",
        since: "2026-10-27T12:00:00.000Z",
      },
    ]);
  });

  test("drops last week's Picks when the week rolls over", async () => {
    // #given
    const box = sandbox();
    await weekOfPicks(box);

    // #when
    const json = report(box, NEXT_MONDAY);

    // #then
    expect({ week: json.week, picks: json.picks }).toEqual({ week: "2026-W45", picks: [] });
  });
});

describe("the paper-bot picks command", () => {
  function paperBot({ storePath }: Sandbox, args: string[]) {
    const home = tempDir();
    const result = Bun.spawnSync(["bun", CLI, ...args], { cwd: home, env: { PATH: process.env.PATH, HOME: home, PAPER_BOT_DB: storePath } });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  test("prints the report as JSON from a store it cannot write to, and needs no config", () => {
    // #given
    const box = sandbox();
    emptyStore(box);
    chmodSync(box.storePath, 0o444);
    chmodSync(dirname(box.storePath), 0o555);

    // #when
    const result = paperBot(box, ["picks", "--json"]);

    // #then
    chmodSync(dirname(box.storePath), 0o755);
    const json: unknown = result.exitCode === 0 ? JSON.parse(result.stdout) : result.stderr;
    expect(json).toEqual({ scans: { daily: null, weekly: null }, keeps: { failing: [] }, week: expect.stringMatching(/^\d{4}-W\d{2}$/), picks: [] });
  });

  test("exits 1 naming the store when there is none, and creates none", () => {
    // #given
    const box = sandbox();

    // #when
    const result = paperBot(box, ["picks", "--json"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr.startsWith(`paper-bot: cannot read the store at ${box.storePath}: `), created: existsSync(box.storePath) }).toEqual({
      exitCode: 1,
      stderr: true,
      created: false,
    });
  });

  test("without --json is a usage error", () => {
    // #given
    const box = sandbox();
    emptyStore(box);

    // #when
    const result = paperBot(box, ["picks"]);

    // #then
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 2, stderr: `paper-bot: ${USAGE}\n` });
  });
});
