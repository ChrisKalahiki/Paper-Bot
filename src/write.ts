import { primaryId } from "./candidate.ts";
import { type Exec, parseJson, runCommand } from "./command.ts";
import { PaperBotError } from "./errors.ts";
import type { Interest } from "./interests.ts";
import { dailyPrompt, type PickToWrite } from "./prompts.ts";

const WRITE_TIMEOUT_MS = 10 * 60 * 1000;

/** The prose of a Daily Briefing; code lays out everything else. `picks` is keyed by each Pick's primary id. */
export type DailyProse = { take: string; picks: Map<string, { why: string; summary: string }> };

export type Writer = (picks: PickToWrite[], interests: Interest[], at: Date, since?: Date) => Promise<DailyProse>;

export const DAILY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["take", "picks"],
  properties: {
    take: { type: "string" },
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "why", "summary"],
        properties: { id: { type: "string" }, why: { type: "string" }, summary: { type: "string" } },
      },
    },
  },
};

export function claudeWriter(exec: Exec, model: string): Writer {
  return async (picks, interests, at, since) => readProse(await claudeJson(exec, model, DAILY_SCHEMA, dailyPrompt(picks, interests, at, since)), picks);
}

/** `claude -p` with no tools, MCP servers, settings or saved session: text in, schema-shaped JSON out. */
export async function claudeJson(exec: Exec, model: string, schema: object, prompt: string): Promise<unknown> {
  const argv = [
    "claude",
    "-p",
    "--no-session-persistence",
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--safe-mode",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
  ];
  const stdout = await runCommand(exec, "claude -p", argv, { stdin: prompt, timeoutMs: WRITE_TIMEOUT_MS });
  return structuredOutput(parseJson("claude -p", stdout));
}

/** claude can exit 0 with `is_error` set, so that flag decides, never `subtype`. */
function structuredOutput(envelope: unknown): unknown {
  if (typeof envelope !== "object" || envelope === null) throw new PaperBotError("claude -p printed no JSON object");
  if ("is_error" in envelope && envelope.is_error === true) {
    const said = "result" in envelope && typeof envelope.result === "string" ? envelope.result.split("\n")[0] : "";
    throw new PaperBotError(`claude -p failed${said ? `: ${said}` : ""}`);
  }
  if (!("structured_output" in envelope)) throw new PaperBotError("claude -p returned no structured output");
  return envelope.structured_output;
}

function readProse(output: unknown, picks: PickToWrite[]): DailyProse {
  if (typeof output !== "object" || output === null || !("take" in output) || typeof output.take !== "string" || !("picks" in output) || !Array.isArray(output.picks)) {
    throw new PaperBotError("claude -p returned prose in the wrong shape");
  }
  const written = new Map<string, { why: string; summary: string }>();
  for (const entry of output.picks as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, why, summary } = entry as Record<string, unknown>;
    if (typeof id === "string" && typeof why === "string" && typeof summary === "string") written.set(id, { why: oneLine(why), summary: oneLine(summary) });
  }
  const missing = picks.map(({ candidate }) => primaryId(candidate)).filter((id) => !written.has(id));
  if (missing.length > 0) throw new PaperBotError(`claude -p wrote nothing for ${missing.join(", ")}`);
  return { take: oneLine(output.take), picks: written };
}

export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
