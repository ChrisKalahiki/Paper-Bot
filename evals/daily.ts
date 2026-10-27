import { primaryId } from "../src/candidate.ts";
import { catchUpSince } from "../src/catch-up.ts";
import { localDate } from "../src/clock.ts";
import type { Interest } from "../src/interests.ts";
import { dailyPrompt, type PickInput } from "../src/prompts.ts";
import { DAILY_SCHEMA } from "../src/write.ts";
import { checkDaily } from "./assertions.ts";
import { asked, fixtureCases } from "./case.ts";
import { type Ask, WRITE_MODEL } from "./claude.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { type Criterion, grade } from "./rubric.ts";

// The Daily Briefing's prose, written by the production prompt and schema from synthetic Picks.

const FIXTURES = "evals/fixtures/daily";

/**
 * `at` is a local date-time; `coveredThrough`, set for a catch-up, is the date arXiv was last covered. A Pick's `fullText` is null when it is
 * written from its abstract.
 */
type DailyFixture = { at: string; coveredThrough?: string; interests: Interest[]; picks: (PickInput & { fullText: string | null })[] };

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
    cases: fixtureCases<DailyFixture>(FIXTURES, CASES, (fixture) => runCase(ask, fixture)),
  };
}

async function runCase(ask: Ask, { at, coveredThrough, interests, picks }: DailyFixture): Promise<CaseResult> {
  const day = new Date(at);
  const covers = catchUpSince(coveredThrough, localDate(day));
  const prompt = dailyPrompt(
    picks.map((pick) => ({ ...pick, fullText: pick.fullText ?? undefined })),
    interests,
    day,
  );
  const answer = await asked(ask, DAILY_SCHEMA, prompt);
  if ("error" in answer) return { failures: [answer.error] };
  const { reply } = answer;
  const ids = picks.map(({ candidate }) => primaryId(candidate));
  const failures = checkDaily(reply, { ids, ...(covers === undefined ? {} : { covers }) }, prompt);
  return { failures, grade: await grade(ask, RUBRIC, prompt, JSON.stringify(reply, null, 2)) };
}
