import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { messageOf, PaperBotError } from "./errors.ts";

export type Config = {
  /** Pinned models: `rank` for `codex exec`, `write` for `claude -p`. */
  models: { rank: string; write: string };
  /** The `brain-dump` command: a name on PATH or an absolute path. */
  brainDump: string;
  arxiv: { categories: string[] };
  /** Venue name, as the Interests Note writes it, to its OpenAlex source id. */
  venues: Record<string, string>;
  /** The free OpenAlex API key. */
  openalex: { key: string };
  /** A Pick scores at least `pick`; a Wildcard at least `wildcard`. */
  bars: { pick: number; wildcard: number };
  /** Candidates per ranking call, and at most `cap` calls per Scan. */
  batch: { size: number; cap: number };
};

type Env = Record<string, string | undefined>;

export type Paths = { config: string; store: string; logs: string };

export function paths(env: Env): Paths {
  const home = env.HOME || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
  return {
    config: join(configHome, "paper-bot", "config.json"),
    store: env.PAPER_BOT_DB || join(dataHome, "paper-bot", "paper-bot.db"),
    logs: join(home, "Library", "Logs", "paper-bot"),
  };
}

/** Reads and validates the config file, which must be private to its owner since it will hold keys. */
export function loadConfig(path: string): Config {
  let text: string;
  let mode: number;
  try {
    mode = statSync(path).mode;
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new PaperBotError(`cannot read the config at ${path}: ${messageOf(error)}; start from config.example.json`);
  }
  if ((mode & 0o077) !== 0) throw new PaperBotError(`${path} is readable by other users; make it private with chmod 600 ${path}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PaperBotError(`${path} is not valid JSON: ${messageOf(error)}`);
  }
  try {
    return parseConfig(value);
  } catch (error) {
    throw new PaperBotError(`${path}: ${messageOf(error)}`);
  }
}

export function parseConfig(value: unknown): Config {
  const root = object(value, "the config");
  const models = object(root.models, "models");
  const arxiv = object(root.arxiv, "arxiv");
  const openalex = object(root.openalex, "openalex");
  const bars = object(root.bars, "bars");
  const batch = object(root.batch, "batch");
  const categories = arxiv.categories;
  if (!Array.isArray(categories) || categories.length === 0 || !categories.every((c) => typeof c === "string" && /^[\w.-]+$/.test(c))) {
    throw new PaperBotError("arxiv.categories must be a non-empty list of arXiv categories such as cs.AI");
  }
  return {
    models: { rank: text(models.rank, "models.rank"), write: text(models.write, "models.write") },
    brainDump: text(root.brainDump, "brainDump"),
    arxiv: { categories },
    venues: venueMap(root.venues),
    openalex: { key: text(openalex.key, "openalex.key") },
    bars: { pick: integer(bars.pick, "bars.pick", 0, 10), wildcard: integer(bars.wildcard, "bars.wildcard", 0, 10) },
    batch: { size: integer(batch.size, "batch.size", 1, 1000), cap: integer(batch.cap, "batch.cap", 1, 1000) },
  };
}

function venueMap(value: unknown): Record<string, string> {
  const venues = object(value, "venues");
  for (const [name, id] of Object.entries(venues)) {
    if (typeof id !== "string" || !/^S\d+$/.test(id)) throw new PaperBotError(`venues.${name} must be the id of an OpenAlex source, such as S4363607743`);
  }
  return venues as Record<string, string>;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PaperBotError(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new PaperBotError(`${field} must be a non-empty string`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PaperBotError(`${field} must be a whole number from ${min} to ${max}`);
  }
  return value;
}
