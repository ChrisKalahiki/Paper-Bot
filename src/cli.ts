#!/usr/bin/env bun
import { type ParseArgsConfig, parseArgs } from "node:util";
import { lastWeek, systemClock } from "./clock.ts";
import { spawnExec } from "./command.ts";
import { loadConfig, paths } from "./config.ts";
import { PaperBotError, UsageError } from "./errors.ts";
import { httpFetch } from "./http.ts";
import { systemSleep } from "./retry.ts";
import { dailyScan, type ScanDeps } from "./scan.ts";
import { type SettledScan, scheduledScans } from "./schedule.ts";
import { openStore, type ScanKind } from "./store.ts";
import { weeklyScan } from "./weekly.ts";

const USAGE = "usage: paper-bot scan [--daily | --weekly]";

const SCAN_NAMES: Record<ScanKind, string> = { daily: "Daily Scan", weekly: "Weekly Scan" };

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "scan": {
      const { daily, weekly } = parseOptions(rest, { daily: { type: "boolean" }, weekly: { type: "boolean" } });
      if (daily && weekly) throw new UsageError(USAGE);
      if (daily) return await scan(async (deps) => [{ kind: "daily", ...(await dailyScan(deps)) }]);
      if (weekly) return await scan(async (deps) => [{ kind: "weekly", ...(await weeklyScan(deps, lastWeek(deps.clock()))) }]);
      return await scan(scheduledScans);
    }
    default:
      throw new UsageError(USAGE);
  }
}

/** Runs the Scans against the real config, store, sources and CLIs, printing how each settled; exits 1 if any failed. */
async function scan(scans: (deps: ScanDeps) => Promise<SettledScan[]>): Promise<number> {
  const where = paths(process.env);
  const config = loadConfig(where.config);
  const store = openStore(where.store);
  try {
    const settled = await scans({ config, store, fetch: httpFetch, exec: spawnExec, clock: systemClock, logDir: where.logs, sleep: systemSleep });
    for (const { kind, outcome, reason, briefing } of settled) {
      const name = SCAN_NAMES[kind];
      if (outcome === "failed") process.stderr.write(`paper-bot: ${name} failed: ${reason}\n`);
      else process.stdout.write(outcome === "written" ? `${name} wrote ${briefing}\n` : `${name} skipped: ${reason}\n`);
    }
    return settled.some(({ outcome }) => outcome === "failed") ? 1 : 0;
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
