import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnExec } from "../src/command.ts";
import { parseConfig } from "../src/config.ts";
import { claudeJson } from "../src/write.ts";

/** `config.example.json`, which a real config copies: its pinned models are part of the evals' hashes. */
export const EXAMPLE_CONFIG = parseConfig(JSON.parse(readFileSync(join(import.meta.dir, "..", "config.example.json"), "utf8")));

/** The writing model pinned in the example config; it is part of the writing evals' hashes. */
export const WRITE_MODEL = EXAMPLE_CONFIG.models.write;

/** Schema-shaped JSON from the model for a prompt; throws a `PaperBotError` when the call fails. Tests hand in canned replies instead. */
export type Ask = (schema: object, prompt: string) => Promise<unknown>;

/** The production `claude -p` call on the pinned model. */
export const askClaude: Ask = (schema, prompt) => claudeJson(spawnExec, WRITE_MODEL, schema, prompt);
