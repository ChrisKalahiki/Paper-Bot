import { spawnExec } from "../src/command.ts";
import { codexJson } from "../src/rank.ts";
import { type Ask, EXAMPLE_CONFIG } from "./claude.ts";

/** The ranking model pinned in the example config, which a real config copies; it is part of the rank eval's hash. */
export const RANK_MODEL = EXAMPLE_CONFIG.models.rank;

/** The production `codex exec` call on the pinned model. */
export const askCodex: Ask = (schema, prompt) => codexJson(spawnExec, RANK_MODEL, schema, prompt);
