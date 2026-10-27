import { SOURCE_LABELS, type SourceName } from "./candidate.ts";
import { isoWeek, localDate } from "./clock.ts";
import type { Outcome, SettledScanRow, Store } from "./store.ts";

type ReportedOutcome = "briefing" | "skipped" | "failed";

export type ReportedDailyScan = {
  at: string;
  date: string;
  outcome: ReportedOutcome;
  reason: string | null;
  sources: { name: SourceName; ok: boolean; error: string | null }[];
};

/** `week` is the ISO week the Scan covers, the one before it ran. */
export type ReportedWeeklyScan = { at: string; week: string; outcome: ReportedOutcome; reason: string | null };

export type ReportedPick = {
  id: string;
  title: string;
  url: string;
  date: string;
  interests: string[];
  wildcard: boolean;
  why: string;
  kept: boolean;
  keptAt: string | null;
  briefing: string;
};

/** What `paper-bot picks --json` prints: the contract homeros's paper-bot Source polls (ChrisKalahiki/homeros#77). */
export type PicksReport = {
  scans: { daily: ReportedDailyScan | null; weekly: ReportedWeeklyScan | null };
  /** `since` is the Keep's first failed try. */
  keeps: { failing: { id: string; title: string; error: string; since: string }[] };
  week: string;
  picks: ReportedPick[];
};

const OUTCOMES: Record<Outcome, ReportedOutcome> = { written: "briefing", skipped: "skipped", failed: "failed" };

/** The latest Scans, failing Keeps and the Picks of the ISO week `now` falls in. */
export function picksReport(store: Store, now: Date): PicksReport {
  const week = isoWeek(now);
  const picks = store
    .weekPicks(localDate(week.monday), localDate(week.sunday))
    .map(({ paper, title, url, date, interests, wildcard, why, kept, keptAt, briefing }) => ({ id: paper, title, url, date, interests, wildcard, why, kept, keptAt, briefing }));
  return {
    scans: { daily: dailyScan(store.lastSettled("daily")), weekly: weeklyScan(store.lastSettled("weekly")) },
    keeps: { failing: store.failingKeeps().map(({ paper, title, error, at }) => ({ id: paper, title, error, since: at })) },
    week: week.name,
    picks,
  };
}

function weeklyScan(scan: SettledScanRow | null): ReportedWeeklyScan | null {
  if (scan === null) return null;
  const [year = 0, month = 1, day = 1] = scan.date.split("-").map(Number);
  return { at: scan.at, week: isoWeek(new Date(year, month - 1, day)).name, outcome: OUTCOMES[scan.outcome], reason: scan.reason };
}

function dailyScan(scan: SettledScanRow | null): ReportedDailyScan | null {
  if (scan === null) return null;
  const results = scan.sources ?? {};
  const sources = (Object.keys(SOURCE_LABELS) as SourceName[]).flatMap((name) => {
    const result = results[name];
    if (result === undefined) return [];
    return [{ name, ok: !("error" in result), error: "error" in result ? result.error : null }];
  });
  return { at: scan.at, date: scan.date, outcome: OUTCOMES[scan.outcome], reason: scan.reason, sources };
}
