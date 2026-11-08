import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Candidate, primaryId } from "../src/candidate.ts";
import { parseInterestsNote } from "../src/interests.ts";
import { rankPrompt } from "../src/prompts.ts";
import { RANK_SCHEMA } from "../src/rank.ts";
import { checkRank, type Label } from "./assertions.ts";
import { asked } from "./case.ts";
import type { Ask } from "./claude.ts";
import { RANK_MODEL } from "./codex.ts";
import type { CaseResult, Eval } from "./eval.ts";
import { EXAMPLE_CONFIG } from "./example-config.ts";
import { type Criterion, grade } from "./rubric.ts";

// The production ranking prompt and schema on one frozen real day of Candidates plus hand-written edge cases, checked against Chris's labels.

const ROOT = resolve(import.meta.dir, "..");

/** Repo-relative, or absolute in tests. `day` is refreshed by `evals/refresh-rank-fixture.ts`; `edgeCases` is written by hand. */
export type RankFixtureFiles = { interests: string; day: string; edgeCases: string };

export const RANK_FIXTURES: RankFixtureFiles = {
  interests: "evals/fixtures/rank/interests.md",
  day: "evals/fixtures/rank/day.json",
  edgeCases: "evals/fixtures/rank/edge-cases.json",
};

const LABELS: readonly string[] = ["must-pick", "must-not", "don't-care"] satisfies Label[];

/** `label` is empty until Chris labels the Candidate; `edge` says what a hand-written edge case tests. */
export type LabelledCandidate = { label: string; edge?: string; candidate: Candidate };

/** `day` is the local date the real Candidates were frozen on. */
export type RankFixture = { day?: string; candidates: LabelledCandidate[] };

const RUBRIC: Criterion[] = [
  {
    name: "specific",
    ask: "Each why line names what in that Candidate bears on the Interests it matched, specific enough that it could not be pasted onto another Candidate of the same Interest.",
  },
];

const readJson = (path: string): RankFixture => JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as RankFixture;

/** The day's Candidates, then the edge cases, as the ranker gets them. */
export function readRankFixtures(files: RankFixtureFiles): LabelledCandidate[] {
  return [...readJson(files.day).candidates, ...readJson(files.edgeCases).candidates];
}

export function rankEval(ask: Ask, files: RankFixtureFiles = RANK_FIXTURES): Eval {
  return {
    name: "rank",
    model: RANK_MODEL,
    entries: ["src/rank.ts", "evals/rank.ts"],
    inputs: ["config.example.json", files.interests, files.day, files.edgeCases],
    cases: [{ name: "day", run: () => runDay(ask, files) }],
  };
}

async function runDay(ask: Ask, files: RankFixtureFiles): Promise<CaseResult> {
  const labelled = readRankFixtures(files);
  const unlabelled = labelled.filter(({ label }) => label === "").length;
  if (unlabelled > 0) {
    return {
      failures: [
        `${unlabelled} of ${labelled.length} Candidates have no label yet; label each must-pick, must-not or don't-care in ${files.day} and ${files.edgeCases} before a pass can be recorded`,
      ],
    };
  }
  const unknown = labelled.filter(({ label }) => !LABELS.includes(label));
  if (unknown.length > 0) {
    return { failures: unknown.map(({ label, candidate }) => `${primaryId(candidate)} has the label "${label}", not must-pick, must-not or don't-care`) };
  }
  const note = parseInterestsNote(readFileSync(resolve(ROOT, files.interests), "utf8"), Object.keys(EXAMPLE_CONFIG.venues));
  const prompt = rankPrompt(
    labelled.map(({ candidate }) => candidate),
    note,
  );
  const answer = await asked(ask, RANK_SCHEMA, prompt);
  if ("error" in answer) return { failures: [answer.error] };
  const { reply } = answer;
  const labels = Object.fromEntries(labelled.map(({ label, candidate }) => [primaryId(candidate), label as Label]));
  const failures = checkRank(reply, { labels, bars: EXAMPLE_CONFIG.bars, wildcardCap: note.wildcards.cap });
  return { failures, grade: await grade(ask, RUBRIC, prompt, JSON.stringify(reply, null, 2)) };
}
