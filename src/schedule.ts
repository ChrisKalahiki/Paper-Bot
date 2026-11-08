import { lastWeek, localDate } from "./clock.ts";
import { dailyScan, type ScanDeps, type ScanResult } from "./scan.ts";
import type { ScanKind } from "./store.ts";
import { weeklyScan } from "./weekly.ts";

export type SettledScan = ScanResult & { kind: ScanKind };

/**
 * What `paper-bot scan` does: the Daily Scan, then the Weekly Scan of last week unless one already wrote or skipped it.
 * Only the Daily Scan sends Keeps.
 * That is every Monday, and any later day when Monday's was missed or failed.
 */
export async function scheduledScans(deps: ScanDeps): Promise<SettledScan[]> {
  const daily: SettledScan = { kind: "daily", ...(await dailyScan(deps)) };
  const week = lastWeek(deps.clock());
  const monday = localDate(week.monday);
  const settled = deps.store
    .scans()
    .some(({ kind, date, outcome }) => kind === "weekly" && date === monday && (outcome === "written" || outcome === "skipped"));
  if (settled) return [daily];
  return [daily, { kind: "weekly", ...(await weeklyScan(deps, week, { keeps: false })) }];
}
