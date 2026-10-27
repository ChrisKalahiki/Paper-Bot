import { type KeptDump, writeDumpArgv } from "../src/brain-dump.ts";
import type { CommandResult, Exec } from "../src/command.ts";
import { messageOf, PaperBotError } from "../src/errors.ts";
import { KEEP_SCHEMA, type KeepDraft, keptDump } from "../src/keep.ts";
import { keepPrompt } from "../src/prompts.ts";
import type { KeepablePick } from "../src/store.ts";
import { checkKeep } from "./assertions.ts";
import { asked, fixtureCases } from "./case.ts";
import { type Ask, WRITE_MODEL } from "./claude.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { type Criterion, grade } from "./rubric.ts";

// A Kept Pick's Dump, drafted by the production prompt and schema, rendered as Keeps render it, and checked by `brain-dump write-dump --dry-run`.

const FIXTURES = "evals/fixtures/keep";

type KeepFixture = { briefing: string; pick: KeepablePick };

const CASES = ["full-text.json", "abstract-only.json", "wildcard.json"];

const RUBRIC: Criterion[] = [
  { name: "self-contained", ask: "Each Learning reads cold a month from now, filed on its own, without the Paper or the other Learnings beside it." },
  { name: "worth keeping", ask: "Each Learning is worth keeping a month from now: a method, a finding or a limit, not a restatement of the title." },
];

const DRY_RUN_TIMEOUT_MS = 60_000;

/** Every reason `write-dump` would refuse the Dump; empty when it would write it. */
export type DumpCheck = (dump: KeptDump) => Promise<string[]>;

/** Brain-Dump's own check of a Dump: the `write-dump` Keeps use, with `--dry-run`, which writes nothing. */
export function writeDumpDryRun(exec: Exec, command: string): DumpCheck {
  return async (dump) => {
    let result: CommandResult;
    try {
      result = await exec([...writeDumpArgv(command, dump), "--dry-run"], { stdin: dump.body, timeoutMs: DRY_RUN_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof PaperBotError)) throw error;
      return [messageOf(error)];
    }
    if (result.exitCode === 0) return [];
    const said = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
    if (result.exitCode === 2 && /Unknown option '--(?:dry-run|origin|briefing|paper)'/.test(said)) {
      return [`brain-dump write-dump can't check the Dump: it has no --dry-run or Briefing origin yet (Brain-Dump#127); it said: ${said}`];
    }
    return [`brain-dump write-dump --dry-run refused the Dump (${result.exitCode === null ? "timed out" : `exit ${result.exitCode}`}): ${said}`];
  };
}

export function keepEval(ask: Ask, check: DumpCheck): Eval {
  return {
    name: "keep",
    model: WRITE_MODEL,
    entries: ["src/keep.ts", "evals/keep.ts"],
    inputs: CASES.map((fixture) => `${FIXTURES}/${fixture}`),
    cases: fixtureCases<KeepFixture>(FIXTURES, CASES, (fixture) => runCase(ask, check, fixture)),
  };
}

async function runCase(ask: Ask, check: DumpCheck, { briefing, pick }: KeepFixture): Promise<CaseResult> {
  const prompt = keepPrompt(pick);
  const answer = await asked(ask, KEEP_SCHEMA, prompt);
  if ("error" in answer) return { failures: [answer.error] };
  const { reply } = answer;
  const failures = checkKeep(reply, prompt);
  if (failures.length > 0) return { failures };
  const dump = keptDump(pick, briefing, reply as KeepDraft);
  return { failures: await check(dump), grade: await grade(ask, RUBRIC, prompt, dump.body) };
}
