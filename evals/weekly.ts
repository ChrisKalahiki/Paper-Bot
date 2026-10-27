import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderWeeklyBriefing, type Theme } from "../src/briefing.ts";
import { messageOf, PaperBotError } from "../src/errors.ts";
import { weeklyPrompt } from "../src/prompts.ts";
import type { WeekPick } from "../src/store.ts";
import { THEMES_SCHEMA } from "../src/weekly.ts";
import { checkTopPicks, checkWeekly } from "./assertions.ts";
import { type Ask, WRITE_MODEL } from "./claude.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { type Criterion, grade } from "./rubric.ts";

// The Weekly Briefing's themes, written by the production prompt and schema from a synthetic week of Picks, then rendered as the note.

const FIXTURES = "evals/fixtures/weekly";

/** The week's dates are local date-times. */
type WeeklyFixture = { week: { name: string; monday: string; sunday: string }; interests: string[]; dailies: string[]; picks: WeekPick[] };

const CASES = ["week.json"];

const RUBRIC: Criterion[] = [{ name: "trends", ask: "Each theme names a trend running through several Picks, not a restatement of one of the Interests." }];

export function weeklyEval(ask: Ask): Eval {
  return {
    name: "weekly",
    model: WRITE_MODEL,
    entries: ["src/weekly.ts", "evals/weekly.ts"],
    inputs: CASES.map((fixture) => `${FIXTURES}/${fixture}`),
    cases: CASES.map((fixture) => ({ name: fixture.replace(/\.json$/, ""), run: () => runCase(ask, fixture) })),
  };
}

async function runCase(ask: Ask, fixture: string): Promise<CaseResult> {
  const { week: dates, interests, dailies, picks } = JSON.parse(readFileSync(join(import.meta.dir, "..", FIXTURES, fixture), "utf8")) as WeeklyFixture;
  const week = { name: dates.name, monday: new Date(dates.monday), sunday: new Date(dates.sunday) };
  const prompt = weeklyPrompt(week, picks, interests);
  let reply: unknown;
  try {
    reply = await ask(THEMES_SCHEMA, prompt);
  } catch (error) {
    if (!(error instanceof PaperBotError)) throw error;
    return { failures: [messageOf(error)] };
  }
  const failures = checkWeekly(
    reply,
    picks.map(({ title }) => title),
    prompt,
  );
  if (failures.length > 0) return { failures };
  const { themes } = reply as { themes: Theme[] };
  const markdown = renderWeeklyBriefing({ week, themes, interests, picks, dailies });
  return {
    failures: checkTopPicks(
      markdown,
      picks.map(({ url }) => url),
    ),
    grade: await grade(ask, RUBRIC, prompt, JSON.stringify(reply, null, 2)),
  };
}
