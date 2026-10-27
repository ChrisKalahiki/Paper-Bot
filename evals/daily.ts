import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryId } from "../src/candidate.ts";
import { messageOf, PaperBotError } from "../src/errors.ts";
import type { Interest } from "../src/interests.ts";
import { dailyPrompt, type PickInput } from "../src/prompts.ts";
import { DAILY_SCHEMA } from "../src/write.ts";
import { checkDaily } from "./assertions.ts";
import { type Ask, WRITE_MODEL } from "./claude.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { type Criterion, grade } from "./rubric.ts";

// The Daily Briefing's prose, written by the production prompt and schema from synthetic Picks.

const FIXTURES = "evals/fixtures/daily";

/** `at` and `since` are local date-times; a Pick's `fullText` is null when it is written from its abstract. */
type DailyFixture = { at: string; since?: string; interests: Interest[]; picks: (PickInput & { fullText: string | null })[] };

const CASES = ["normal.json", "thin.json", "catch-up.json"];

const RUBRIC: Criterion[] = [
  { name: "faithful", ask: "Every why line and summary says only what that Pick's abstract or full text says, with no claim beyond it." },
  { name: "take", ask: "The take says something worth reading about today's Picks together, not a list of them." },
];

export function dailyEval(ask: Ask): Eval {
  return {
    name: "daily",
    model: WRITE_MODEL,
    entries: ["src/write.ts", "evals/daily.ts"],
    inputs: ["GLOSSARY.md", ...CASES.map((fixture) => `${FIXTURES}/${fixture}`)],
    cases: CASES.map((fixture) => ({ name: fixture.replace(/\.json$/, ""), run: () => runCase(ask, fixture) })),
  };
}

async function runCase(ask: Ask, fixture: string): Promise<CaseResult> {
  const { at, since, interests, picks } = JSON.parse(readFileSync(join(import.meta.dir, "..", FIXTURES, fixture), "utf8")) as DailyFixture;
  const [day, first] = [new Date(at), since === undefined ? undefined : new Date(since)];
  const prompt = dailyPrompt(
    picks.map((pick) => ({ ...pick, fullText: pick.fullText ?? undefined })),
    interests,
    day,
    first,
  );
  let reply: unknown;
  try {
    reply = await ask(DAILY_SCHEMA, prompt);
  } catch (error) {
    if (!(error instanceof PaperBotError)) throw error;
    return { failures: [messageOf(error)] };
  }
  const ids = picks.map(({ candidate }) => primaryId(candidate));
  const failures = checkDaily(reply, { ids, ...(first === undefined ? {} : { covers: { from: first, to: day } }) }, prompt);
  return { failures, grade: await grade(ask, RUBRIC, prompt, JSON.stringify(reply, null, 2)) };
}
