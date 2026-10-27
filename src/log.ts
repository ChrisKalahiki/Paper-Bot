import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Clock, localDate, localTime } from "./clock.ts";
import type { ScanKind } from "./store.ts";

export type ScanLog = (message: string) => void;

/** Appends timestamped lines to `<dir>/<date>-<kind>.log`; a repeated Scan on the same day adds to the same file. */
export function openScanLog(dir: string, kind: ScanKind, clock: Clock): ScanLog {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${localDate(clock())}-${kind}.log`);
  return (message) => appendFileSync(path, `${localTime(clock())} ${message}\n`);
}

/** Deletes the Scan logs in `dir` dated before `before` (`YYYY-MM-DD`), leaving other files; returns how many. */
export function deleteScanLogsBefore(dir: string, before: string): number {
  const old = readdirSync(dir).filter((file) => {
    const date = file.match(/^(\d{4}-\d{2}-\d{2})-(?:daily|weekly)\.log$/)?.[1];
    return date !== undefined && date < before;
  });
  for (const file of old) rmSync(join(dir, file));
  return old.length;
}
