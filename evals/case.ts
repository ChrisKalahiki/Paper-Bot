import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messageOf, PaperBotError } from "../src/errors.ts";
import type { Ask } from "./claude.ts";
import type { CaseResult, EvalCase } from "./eval.ts";

// What every eval case shares: reading its fixture, its name, and asking the model.

/** One case per fixture file in `dir` (repo-relative), named for the file, each running `run` on the parsed fixture. */
export function fixtureCases<T>(dir: string, files: string[], run: (fixture: T) => Promise<CaseResult>): EvalCase[] {
  return files.map((file) => ({
    name: file.replace(/\.json$/, ""),
    run: () => run(JSON.parse(readFileSync(join(import.meta.dir, "..", dir, file), "utf8")) as T),
  }));
}

/** The model's reply to `prompt`, or the error of a call that failed with a PaperBotError. */
export async function asked(ask: Ask, schema: object, prompt: string): Promise<{ reply: unknown } | { error: string }> {
  try {
    return { reply: await ask(schema, prompt) };
  } catch (error) {
    if (!(error instanceof PaperBotError)) throw error;
    return { error: messageOf(error) };
  }
}
