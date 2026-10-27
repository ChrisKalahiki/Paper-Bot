import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { lastWeek } from "../src/clock.ts";
import type { Fetch } from "../src/http.ts";
import { dailyScan } from "../src/scan.ts";
import { scheduledScans } from "../src/schedule.ts";
import { openStore } from "../src/store.ts";
import { weeklyScan } from "../src/weekly.ts";
import { arxivApiOf, arxivFeedOf, arxivFetch, type FakeCommands, fakeCommands, fakeSleep, MONDAY, sourcesFetch, tempDir, testConfig } from "./harness.ts";

const TUESDAY = new Date("2026-10-27T12:00:00Z");
const WEDNESDAY = new Date("2026-10-28T12:00:00Z");
const WEEKLY = "Research/Briefings/Weekly/2026-W43 Weekly Briefing.md";
const DAILY_20 = "Research/Briefings/Daily/2026-10-20 Daily Briefing.md";
const context = ["Context management in AI"];

const RANKINGS = {
  "arxiv:2610.31679": { score: 9, interests: ["AI in higher education", ...context] },
  "arxiv:2610.32109": { score: 8, interests: context },
  "arxiv:2610.30001": { score: 9, interests: context },
  "arxiv:2610.30002": { score: 8, wildcard: true },
};

function sandbox() {
  const dir = tempDir();
  return { storePath: join(dir, "paper-bot.db"), logDir: join(dir, "logs") };
}

type Sandbox = ReturnType<typeof sandbox>;

async function withStore<T>({ storePath }: Sandbox, use: (store: ReturnType<typeof openStore>) => Promise<T> | T): Promise<T> {
  const store = openStore(storePath);
  try {
    return await use(store);
  } finally {
    store.close();
  }
}

const daily = (box: Sandbox, commands: FakeCommands, at: Date, fetch: Fetch) =>
  withStore(box, (store) => dailyScan({ config: testConfig(), store, fetch, exec: commands.exec, clock: () => at, logDir: box.logDir, sleep: fakeSleep() }));

/** `paper-bot scan` at `at`, when every source has nothing new. */
const scheduled = (box: Sandbox, commands: FakeCommands, at: Date) =>
  withStore(box, (store) => scheduledScans({ config: testConfig(), store, fetch: sourcesFetch(), exec: commands.exec, clock: () => at, logDir: box.logDir, sleep: fakeSleep() }));

/** `paper-bot scan --weekly` at `at`. */
const weekly = (box: Sandbox, commands: FakeCommands, at: Date) =>
  withStore(box, (store) => weeklyScan({ config: testConfig(), store, fetch: sourcesFetch(), exec: commands.exec, clock: () => at, logDir: box.logDir, sleep: fakeSleep() }, lastWeek(at)));

/** Daily Briefings on Tue 20 and Thu 22 Oct (2026-W43), the second catching up on the 21st: four Picks, one a Wildcard. */
async function weekOfPicks(box: Sandbox, commands: FakeCommands): Promise<void> {
  await daily(box, commands, new Date("2026-10-20T12:00:00Z"), arxivFetch());
  await daily(box, commands, new Date("2026-10-22T12:00:00Z"), sourcesFetch({ "https://export.arxiv.org/": arxivApiOf(2) }));
}

const weeklyScans = (box: Sandbox) =>
  withStore(box, (store) => store.scans().filter(({ kind }) => kind === "weekly").map(({ date, outcome, reason, briefing }) => ({ date, outcome, reason, briefing })));

/** The item bounds of the `themes` array in the schema passed to `claude -p --json-schema`. */
function themesSchema(argv: string[]): { minItems: unknown; maxItems: unknown } {
  const schema: unknown = JSON.parse(argv[argv.indexOf("--json-schema") + 1] ?? "{}");
  const themes = (schema as { properties?: { themes?: { minItems?: unknown; maxItems?: unknown } } }).properties?.themes;
  return { minItems: themes?.minItems, maxItems: themes?.maxItems };
}

const claudeCalls = (commands: FakeCommands) => commands.calls.filter(({ argv }) => argv[0] === "claude");

describe("paper-bot scan on a Monday", () => {
  test("runs the Daily Scan, then writes last week's Weekly Briefing", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);

    // #when
    const results = await scheduled(box, commands, MONDAY);

    // #then
    expect(results).toEqual([
      { kind: "daily", outcome: "skipped", reason: "no new Candidates" },
      { kind: "weekly", outcome: "written", briefing: WEEKLY },
    ]);
    expect(commands.vault.get(WEEKLY)).toBe(`---
tags: [briefing, briefing/weekly]
week: 2026-W43
dailies: 2
picks: 4
---

# Weekly Briefing · 2026-W43 (19 Oct – 25 Oct)

## This week in your Interests

**Context is the week's thread.** 4 Picks circle it.

| Interest | Picks | Kept |
| --- | --- | --- |
| AI in higher education | 1 | 0 |
| Context management in AI | 3 | 0 |
| Wildcards | 1 | 0 |

## Top Picks

- [ ] Keep [MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring](https://arxiv.org/abs/2610.31679) · from [[2026-10-20 Daily Briefing]] ^pick-2610-31679
- [ ] Keep [Paper 1](https://arxiv.org/abs/2610.30001) · from [[2026-10-22 Daily Briefing]] ^pick-2610-30001
- [ ] Keep [Context or Knowledge: How LLMs Attribute Their Own Answers](https://arxiv.org/abs/2610.32109) · from [[2026-10-20 Daily Briefing]] ^pick-2610-32109
- [ ] Keep [Paper 2](https://arxiv.org/abs/2610.30002) · from [[2026-10-22 Daily Briefing]] ^pick-2610-30002

## Daily Briefings

[[2026-10-20 Daily Briefing]] · [[2026-10-22 Daily Briefing]]
`);
  });

  test("records the Weekly Scan, dated by the Monday of the week it covers", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);

    // #when
    await scheduled(box, commands, MONDAY);

    // #then
    expect(await weeklyScans(box)).toEqual([{ date: "2026-10-19", outcome: "written", reason: null, briefing: WEEKLY }]);
  });

  test("writes 1 to 4 themes with claude -p, with no tools, against a JSON schema, from the week's Picks", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    const before = claudeCalls(commands).length;

    // #when
    await scheduled(box, commands, MONDAY);

    // #then
    const [call] = claudeCalls(commands).slice(before);
    expect({
      flags: call?.argv.slice(0, 9),
      themes: themesSchema(call?.argv ?? []),
      asks: call?.stdin.includes("two to four threads"),
      ids: (call?.stdin.match(/^id: \S+$/gm) ?? []).length,
    }).toEqual({
      flags: ["claude", "-p", "--no-session-persistence", "--model", "claude-test", "--tools", "", "--strict-mcp-config", "--safe-mode"],
      themes: { minItems: 1, maxItems: 4 },
      asks: true,
      ids: 4,
    });
  });

  test("lists Picks already Kept under Already kept this week instead of Top Picks, and counts them per Interest", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    commands.vault.set(DAILY_20, (commands.vault.get(DAILY_20) ?? "").replace("- [ ] Keep ^pick-2610-31679", "- [x] Keep ^pick-2610-31679"));

    // #when
    await scheduled(box, commands, MONDAY);

    // #then
    const weekly = commands.vault.get(WEEKLY) ?? "";
    expect({
      table: weekly.match(/^\| (AI in|Context).*$/gm),
      top: weekly.match(/^- \[ \] Keep.*\^(\S+)$/gm)?.map((line) => line.replace(/^.*\^/, "")),
      kept: weekly.slice(weekly.indexOf("## Already kept this week"), weekly.indexOf("## Daily Briefings")),
    }).toEqual({
      table: ["| AI in higher education | 1 | 1 |", "| Context management in AI | 3 | 1 |"],
      top: ["pick-2610-30001", "pick-2610-32109", "pick-2610-30002"],
      kept: `## Already kept this week

- [MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring](https://arxiv.org/abs/2610.31679) → in the Inbox

`,
    });
  });

  test("names an Interest with no Pick this week as quiet", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: { "arxiv:2610.32109": { score: 8, interests: context } } });
    await daily(box, commands, new Date("2026-10-20T12:00:00Z"), arxivFetch());

    // #when
    await scheduled(box, commands, MONDAY);

    // #then
    expect(commands.vault.get(WEEKLY)).toContain(`**Context is the week's thread.** 1 Picks circle it.

**Quiet:** AI in higher education had no Pick this week.

| Interest | Picks | Kept |
| --- | --- | --- |
| AI in higher education | 0 | 0 |
| Context management in AI | 1 | 0 |

`);
  });

  test("records a week with no Picks as skipped, writing no Briefing", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands();

    // #when
    const results = await scheduled(box, commands, MONDAY);

    // #then
    expect({ weekly: results[1], scans: await weeklyScans(box), wrote: commands.vault.has(WEEKLY), claude: claudeCalls(commands).length }).toEqual({
      weekly: { kind: "weekly", outcome: "skipped", reason: "no Picks in 2026-W43" },
      scans: [{ date: "2026-10-19", outcome: "skipped", reason: "no Picks in 2026-W43", briefing: null }],
      wrote: false,
      claude: 0,
    });
  });

  test("fails, recording why, when claude reports an error, and writes nothing", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    const failing = fakeCommands({
      notes: Object.fromEntries(commands.vault),
      claude: () => ({ exitCode: 1, stdout: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }), stderr: "" }),
    });

    // #when
    const results = await scheduled(box, failing, MONDAY);

    // #then
    const reason = "claude -p failed (exit 1): {\"is_error\":true,\"result\":\"Not logged in · Please run /login\"}";
    expect({ weekly: results[1], wrote: failing.vault.has(WEEKLY) }).toEqual({ weekly: { kind: "weekly", outcome: "failed", reason }, wrote: false });
  });
});

describe("paper-bot scan on another day", () => {
  test("writes last week's Weekly Briefing when Monday's was missed", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);

    // #when
    const results = await scheduled(box, commands, TUESDAY);

    // #then
    expect({ results, wrote: commands.vault.has(WEEKLY), scans: (await weeklyScans(box)).map(({ date }) => date) }).toEqual({
      results: [
        { kind: "daily", outcome: "skipped", reason: "no new Candidates" },
        { kind: "weekly", outcome: "written", briefing: WEEKLY },
      ],
      wrote: true,
      scans: ["2026-10-19"],
    });
  });

  test("runs only the Daily Scan once last week's Weekly Briefing is written or skipped", async () => {
    // #given
    const written = sandbox();
    const writtenCommands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(written, writtenCommands);
    await scheduled(written, writtenCommands, MONDAY);
    const skipped = sandbox();
    const skippedCommands = fakeCommands();
    await scheduled(skipped, skippedCommands, MONDAY);

    // #when
    const results = [await scheduled(written, writtenCommands, TUESDAY), await scheduled(skipped, skippedCommands, WEDNESDAY)];

    // #then
    expect(results.map((ran) => ran.map(({ kind }: { kind: string }) => kind))).toEqual([["daily"], ["daily"]]);
  });

  test("tries again after a failed Weekly Scan", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    const failing = fakeCommands({ notes: Object.fromEntries(commands.vault), claude: () => ({ exitCode: 1, stdout: "", stderr: "usage limit" }) });
    await scheduled(box, failing, MONDAY);

    // #when
    const results = await scheduled(box, commands, TUESDAY);

    // #then
    expect({ weekly: results[1], scans: (await weeklyScans(box)).map(({ outcome }) => outcome) }).toEqual({
      weekly: { kind: "weekly", outcome: "written", briefing: WEEKLY },
      scans: ["failed", "written"],
    });
  });
});

describe("paper-bot scan --weekly again", () => {
  test("reports the week's Weekly Briefing already written, writing nothing and recording no failed Scan", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    await scheduled(box, commands, MONDAY);
    const again = fakeCommands({ notes: Object.fromEntries(commands.vault) });

    // #when
    const result = await weekly(box, again, TUESDAY);

    // #then
    expect({ result, commands: again.calls.length, scans: (await weeklyScans(box)).map(({ outcome }) => outcome) }).toEqual({
      result: { outcome: "already written", briefing: WEEKLY },
      commands: 0,
      scans: ["written"],
    });
  });

  test("reports a Weekly Briefing the store lost as already written, not failed", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await weekOfPicks(box, commands);
    commands.vault.set(WEEKLY, "written before the store was lost");

    // #when
    const result = await weekly(box, commands, MONDAY);

    // #then
    expect({ result, failed: (await weeklyScans(box)).some(({ outcome }) => outcome === "failed"), note: commands.vault.get(WEEKLY) }).toEqual({
      result: { outcome: "already written", briefing: WEEKLY },
      failed: false,
      note: "written before the store was lost",
    });
  });
});

describe("a Weekly Briefing's week", () => {
  test("is named by ISO week-year: the week of 1 Jan 2027 is 2026-W53", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await daily(box, commands, new Date("2027-01-01T12:00:00Z"), arxivFetch());

    // #when
    const results = await scheduled(box, commands, new Date("2027-01-04T12:00:00Z"));

    // #then
    const path = "Research/Briefings/Weekly/2026-W53 Weekly Briefing.md";
    expect({ weekly: results[1], title: commands.vault.get(path)?.match(/^# .*$/m)?.[0] }).toEqual({
      weekly: { kind: "weekly", outcome: "written", briefing: path },
      title: "# Weekly Briefing · 2026-W53 (28 Dec – 3 Jan)",
    });
  });

  test("leaves out Picks from Daily Briefings of other weeks", async () => {
    // #given
    const box = sandbox();
    const commands = fakeCommands({ rankings: RANKINGS });
    await daily(box, commands, new Date("2026-10-18T12:00:00Z"), arxivFetch());
    await daily(box, commands, new Date("2026-10-22T12:00:00Z"), sourcesFetch({ "https://export.arxiv.org/": arxivApiOf(2) }));
    await daily(box, commands, MONDAY, arxivFetch(arxivFeedOf(0)));

    // #when
    await scheduled(box, commands, MONDAY);

    // #then
    expect(commands.vault.get(WEEKLY)?.match(/\^pick-\S+$/gm)).toEqual(["^pick-2610-30001", "^pick-2610-30002"]);
  });
});
