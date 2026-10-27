import { appendFileSync, mkdirSync } from "node:fs";
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
