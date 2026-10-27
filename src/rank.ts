import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Candidate, primaryId, type Ranking } from "./candidate.ts";
import { type Exec, parseJson, runCommand } from "./command.ts";
import { PaperBotError } from "./errors.ts";
import type { Interest } from "./interests.ts";
import { rankPrompt } from "./prompts.ts";

const RANK_TIMEOUT_MS = 10 * 60 * 1000;

/** Ranks one batch, keyed by each Candidate's primary id. A Candidate the ranker left out has no entry. */
export type Ranker = (batch: Candidate[], interests: Interest[]) => Promise<Map<string, Ranking>>;

/** The OpenAI structured-output shape: every property required, no others allowed. */
const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rankings"],
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "interests", "score", "why", "wildcard"],
        properties: {
          id: { type: "string" },
          interests: { type: "array", items: { type: "string" } },
          score: { type: "integer", minimum: 0, maximum: 10 },
          why: { type: "string" },
          wildcard: { type: "boolean" },
        },
      },
    },
  },
};

export function codexRanker(exec: Exec, model: string): Ranker {
  return async (batch, interests) => {
    const dir = mkdtempSync(join(tmpdir(), "paper-bot-rank-"));
    try {
      const schema = join(dir, "rank-schema.json");
      writeFileSync(schema, JSON.stringify(RANK_SCHEMA));
      const argv = ["codex", "exec", "--ephemeral", "-s", "read-only", "--skip-git-repo-check", "-m", model, "--output-schema", schema, "-"];
      const stdout = await runCommand(exec, "codex exec", argv, { stdin: rankPrompt(batch, interests), timeoutMs: RANK_TIMEOUT_MS });
      return readRankings(parseJson("codex exec", stdout), batch, interests);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Keeps the well-formed rankings of Candidates in the batch, and only the Interests that exist. */
function readRankings(output: unknown, batch: Candidate[], interests: Interest[]): Map<string, Ranking> {
  if (typeof output !== "object" || output === null || !("rankings" in output) || !Array.isArray(output.rankings)) {
    throw new PaperBotError("codex exec printed no rankings");
  }
  const ids = new Set(batch.map(primaryId));
  const names = new Set(interests.map((interest) => interest.name));
  const rankings = new Map<string, Ranking>();
  for (const entry of output.rankings as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, interests: matched, score, why, wildcard } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ids.has(id) || rankings.has(id)) continue;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) continue;
    if (typeof why !== "string" || typeof wildcard !== "boolean" || !Array.isArray(matched)) continue;
    rankings.set(id, {
      interests: matched.filter((name): name is string => typeof name === "string" && names.has(name)),
      score,
      why: why.trim(),
      wildcard,
    });
  }
  if (rankings.size === 0) throw new PaperBotError("codex exec ranked none of the batch");
  return rankings;
}
