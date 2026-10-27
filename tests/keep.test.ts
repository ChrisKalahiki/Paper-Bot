import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate } from "../src/clock.ts";
import type { Fetch } from "../src/http.ts";
import { INTERESTS_NOTE } from "../src/interests.ts";
import { tickedKeeps } from "../src/keep.ts";
import { dailyScan } from "../src/scan.ts";
import { openStore } from "../src/store.ts";
import { arxivFeedOf, arxivFetch, type FakeCommands, type FakeRanking, fakeCommands, fakeSleep, INTERESTS, MONDAY, tempDir, testConfig } from "./harness.ts";

const BRIEFING = "Research/Briefings/Daily/2026-10-26 Daily Briefing.md";
const TUESDAY = new Date("2026-10-27T12:00:00Z");
const WEDNESDAY = new Date("2026-10-28T12:00:00Z");
const THURSDAY = new Date("2026-10-29T12:00:00Z");
const TUESDAY_BRIEFING = "Research/Briefings/Daily/2026-10-27 Daily Briefing.md";
const WEEKLY = "Research/Briefings/Weekly/2026-W44 Weekly Briefing.md";
const DUMP = "Inbox/2026-10-27 0600 AI in higher education - MisconceptDialogue Evaluation Criteria Shape Measured Success.md";

const PICKED = {
  "arxiv:2610.32109": { score: 8, interests: ["Context management in AI"] },
  "arxiv:2610.31679": { score: 9, interests: ["AI in higher education", "Context management in AI"] },
};

function sandbox() {
  const dir = tempDir();
  return { storePath: join(dir, "paper-bot.db"), logDir: join(dir, "logs") };
}

type ScanSetup = { commands: FakeCommands; storePath: string; logDir: string; fetch?: Fetch; at: Date };

async function scan({ commands, storePath, logDir, fetch = arxivFetch(), at }: ScanSetup) {
  const store = openStore(storePath);
  try {
    return await dailyScan({ config: testConfig(), store, fetch, exec: commands.exec, clock: () => at, logDir, sleep: fakeSleep() });
  } finally {
    store.close();
  }
}

function keeps(storePath: string) {
  const store = openStore(storePath);
  try {
    return store.keeps();
  } finally {
    store.close();
  }
}

/** Monday's Daily Briefing, written by a real Scan, with the Keep boxes of `ticked` Picks ticked. */
async function mondayBriefing(storePath: string, logDir: string, ticked: string[], rankings: Record<string, FakeRanking> = PICKED): Promise<string> {
  const monday = fakeCommands({ rankings });
  await scan({ commands: monday, storePath, logDir, at: MONDAY });
  const text = monday.vault.get(BRIEFING) ?? "";
  return ticked.reduce((note, block) => note.replace(`- [ ] Keep ^${block}`, `- [x] Keep ^${block}`), text);
}

const writeDumps = (commands: FakeCommands) => commands.calls.filter(({ argv }) => argv[1] === "write-dump");

describe("a Keep", () => {
  test("turns a Pick ticked in a recent Briefing into a Dump with a Briefing origin, its first Interest as Project", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });

    // #when
    await scan({ commands, storePath, logDir, at: TUESDAY });

    // #then
    expect(writeDumps(commands)).toEqual([
      {
        argv: [
          "brain-dump",
          "write-dump",
          "--origin",
          "briefing",
          "--briefing",
          BRIEFING,
          "--paper",
          "arxiv:2610.31679",
          "--project",
          "AI in higher education",
          "--slug",
          "MisconceptDialogue Evaluation Criteria Shape Measured Success",
        ],
        stdin: `## Learnings
- [ ] Header of arxiv:2610.31679 https://arxiv.org/abs/2610.31679
- [ ] First Learning of arxiv:2610.31679 https://arxiv.org/abs/2610.31679
- [ ] Second Learning of arxiv:2610.31679 https://arxiv.org/abs/2610.31679
`,
      },
    ]);
  });

  test("records the Dump in the store with the Scan that kept it", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });

    // #when
    await scan({ commands, storePath, logDir, at: TUESDAY });

    // #then
    expect(keeps(storePath)).toEqual([{ paper: "arxiv:2610.31679", scanId: 2, briefing: BRIEFING, dump: DUMP, error: null, at: TUESDAY.toISOString() }]);
  });

  test("keeps a Paper once ever: a tick still there, or unticked, on a later Scan writes nothing", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    await scan({ commands: fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } }), storePath, logDir, at: TUESDAY });
    const unticked = briefing.replace("- [x] Keep", "- [ ] Keep");
    const stillTicked = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });
    const nowUnticked = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: unticked } });

    // #when
    await scan({ commands: stillTicked, storePath, logDir, at: WEDNESDAY });
    await scan({ commands: nowUnticked, storePath, logDir, at: THURSDAY });

    // #then
    expect({ writes: [...writeDumps(stillTicked), ...writeDumps(nowUnticked)], kept: keeps(storePath).map(({ dump }) => dump) }).toEqual({ writes: [], kept: [DUMP] });
  });

  test("reads ticks from Weekly Briefings too, sending a Paper ticked in both only once", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const store = openStore(storePath);
    const weeklyScan = store.startScan("weekly", "2026-10-26", MONDAY);
    store.settleScan(weeklyScan, { outcome: "written", briefing: WEEKLY, sources: {}, at: MONDAY }, []);
    store.close();
    const weekly = "# Weekly Briefing\n\n- [x] Keep ^pick-2610-31679\n- [x] Keep ^pick-2610-32109\n";
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing, [WEEKLY]: weekly } });

    // #when
    await scan({ commands, storePath, logDir, at: TUESDAY });

    // #then
    const kept = keeps(storePath).map(({ paper, briefing }) => ({ paper, briefing }));
    expect(kept.sort((a, b) => a.paper.localeCompare(b.paper))).toEqual([
      { paper: "arxiv:2610.31679", briefing: BRIEFING },
      { paper: "arxiv:2610.32109", briefing: WEEKLY },
    ]);
  });

  test("records a refused write with its error and retries it on the next Scan", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const notes = { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing };
    const refused = fakeCommands({ notes, writeDump: (_argv, stdin) => ({ exitCode: 1, stdout: stdin, stderr: "brain-dump: Vault not found at /nowhere\n" }) });
    await scan({ commands: refused, storePath, logDir, at: TUESDAY });
    const failing = keeps(storePath).map(({ dump, error }) => ({ dump, error }));

    // #when
    await scan({ commands: fakeCommands({ notes }), storePath, logDir, at: WEDNESDAY });

    // #then
    expect({ failing, retried: keeps(storePath).map(({ dump, error }) => ({ dump, error })) }).toEqual({
      failing: [{ dump: null, error: "brain-dump write-dump failed (exit 1): brain-dump: Vault not found at /nowhere" }],
      retried: [{ dump: DUMP, error: null }],
    });
  });

  describe("that failed", () => {
    async function failedKeep() {
      const { storePath, logDir } = sandbox();
      const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
      const refused = fakeCommands({
        notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing },
        writeDump: () => ({ exitCode: 1, stdout: "", stderr: "brain-dump: Vault not found at /nowhere\n" }),
      });
      await scan({ commands: refused, storePath, logDir, at: TUESDAY });
      return { storePath, logDir, briefing };
    }

    const logged = (logDir: string, at: Date) => readFileSync(join(logDir, `${localDate(at)}-daily.log`), "utf8");

    test("is dropped, and logged, once Chris unticks it", async () => {
      // #given
      const { storePath, logDir, briefing } = await failedKeep();
      const unticked = briefing.replace("- [x] Keep ^pick-2610-31679", "- [ ] Keep ^pick-2610-31679");
      const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: unticked } });

      // #when
      await scan({ commands, storePath, logDir, at: WEDNESDAY });

      // #then
      expect({ keeps: keeps(storePath), dumps: writeDumps(commands).length, logged: logged(logDir, WEDNESDAY).includes("no longer ticked") }).toEqual({
        keeps: [],
        dumps: 0,
        logged: true,
      });
    });

    test("is dropped, and logged, once its Briefing is more than 30 days old", async () => {
      // #given
      const { storePath, logDir, briefing } = await failedKeep();
      const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });
      const later = new Date("2026-11-26T12:00:00Z");

      // #when
      await scan({ commands, storePath, logDir, at: later });

      // #then
      expect({ keeps: keeps(storePath), dumps: writeDumps(commands).length, logged: logged(logDir, later).includes("more than 30 days old") }).toEqual({
        keeps: [],
        dumps: 0,
        logged: true,
      });
    });

    test("stays failing while its Briefing can't be read", async () => {
      // #given
      const { storePath, logDir } = await failedKeep();
      const commands = fakeCommands();

      // #when
      await scan({ commands, storePath, logDir, at: WEDNESDAY });

      // #then
      expect(keeps(storePath).map(({ paper, error }) => ({ paper, failing: error !== null }))).toEqual([{ paper: "arxiv:2610.31679", failing: true }]);
    });
  });

  test("ignores ticks in Briefings more than 30 days old", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });

    // #when
    await scan({ commands, storePath, logDir, at: new Date("2026-11-26T12:00:00Z") });

    // #then
    expect({ shown: commands.calls.filter(({ argv }) => argv.includes(BRIEFING)), kept: keeps(storePath) }).toEqual({ shown: [], kept: [] });
  });

  test("notes failed Keeps and Keep lines with a missing or edited id in the footer of the Briefing it writes", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const ticked = await mondayBriefing(storePath, logDir, ["pick-2610-31679"]);
    const briefing = `${ticked.replace("- [ ] Keep ^pick-2610-32109", "- [x] Keep ^pick-2610-3210")}   - [x] Keep\n`;
    const commands = fakeCommands({
      rankings: { "arxiv:2610.30001": { score: 9, interests: ["Context management in AI"] } },
      notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing },
      writeDump: () => ({ exitCode: 1, stdout: "", stderr: "brain-dump: invalid Dump body: it has no Items\n" }),
    });

    // #when
    await scan({ commands, storePath, logDir, at: TUESDAY, fetch: arxivFetch(arxivFeedOf(1)) });

    // #then
    expect(commands.vault.get(TUESDAY_BRIEFING)?.split("\n\n").slice(-4)).toEqual([
      "1 candidates · arXiv 1",
      'Keep of "MisconceptDialogue: Evaluation Criteria Shape Measured Success in LLM Math Tutoring" failed, to be retried next Scan: brain-dump write-dump failed (exit 1): brain-dump: invalid Dump body: it has no Items',
      "Ignored the Keep line ^pick-2610-3210 in [[2026-10-26 Daily Briefing]]: it names no Pick.",
      "Ignored a Keep line in [[2026-10-26 Daily Briefing]]: it has no ^pick- id.\n",
    ]);
  });

  test("files a Kept Wildcard, which matches no Interest, under the Wildcards Project", async () => {
    // #given
    const { storePath, logDir } = sandbox();
    const briefing = await mondayBriefing(storePath, logDir, ["pick-2610-32109"], { "arxiv:2610.32109": { score: 9, wildcard: true } });
    const commands = fakeCommands({ notes: { [INTERESTS_NOTE]: INTERESTS, [BRIEFING]: briefing } });

    // #when
    await scan({ commands, storePath, logDir, at: TUESDAY });

    // #then
    expect(writeDumps(commands).map(({ argv }) => argv[argv.indexOf("--project") + 1])).toEqual(["Wildcards"]);
  });
});

describe("reading Keep lines", () => {
  test("finds only ticked Keep lines, with their block ids", () => {
    // #given
    const markdown = `1. **[A](https://arxiv.org/abs/1)**
   - [x] Keep ^pick-1
2. **[B](https://arxiv.org/abs/2)**
   - [ ] Keep ^pick-2
   - [X] Keep it ^pick-3
- [x] Keep
- [x] Keeper ^pick-4
`;

    // #when
    const ticks = tickedKeeps(markdown);

    // #then
    expect(ticks).toEqual([{ block: "pick-1" }, { block: "pick-3" }, {}]);
  });
});
