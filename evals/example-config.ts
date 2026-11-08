import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "../src/config.ts";

/** `config.example.json`, which a real config copies: its pinned models are part of the evals' hashes. */
export const EXAMPLE_CONFIG = parseConfig(JSON.parse(readFileSync(join(import.meta.dir, "..", "config.example.json"), "utf8")));
