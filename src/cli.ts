#!/usr/bin/env bun
import { type ParseArgsConfig, parseArgs } from "node:util";
import { systemClock } from "./clock.ts";
import { spawnExec } from "./command.ts";
import { loadConfig, paths } from "./config.ts";
import { PaperBotError, UsageError } from "./errors.ts";
import { httpFetch } from "./http.ts";
import { systemSleep } from "./retry.ts";
import { dailyScan } from "./scan.ts";
import { openStore } from "./store.ts";

const USAGE = "usage: paper-bot scan [--daily]";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "scan": {
      parseOptions(rest, { daily: { type: "boolean" } });
      return await scanDaily();
    }
    default:
      throw new UsageError(USAGE);
  }
}

async function scanDaily(): Promise<number> {
  const where = paths(process.env);
  const config = loadConfig(where.config);
  const store = openStore(where.store);
  try {
    const result = await dailyScan({ config, store, fetch: httpFetch, exec: spawnExec, clock: systemClock, logDir: where.logs, sleep: systemSleep });
    if (result.outcome === "failed") throw new PaperBotError(`Daily Scan failed: ${result.reason}`);
    process.stdout.write(result.outcome === "written" ? `Daily Scan wrote ${result.briefing}\n` : `Daily Scan skipped: ${result.reason}\n`);
    return 0;
  } finally {
    store.close();
  }
}

function parseOptions<T extends ParseArgsConfig["options"]>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, strict: true }).values;
  } catch (error) {
    throw new UsageError(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
}

// exitCode, not process.exit(): exiting immediately truncates stdout when it is a pipe.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof PaperBotError)) throw error;
  process.stderr.write(`paper-bot: ${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
