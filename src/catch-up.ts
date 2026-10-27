import { MONTHS } from "./clock.ts";

/** A gap longer than this loses its oldest days. */
const MAX_DAYS = 7;

/**
 * The days a Scan catches up on, as noon in the system time zone: those since arXiv was last covered, today last, at
 * most 7. `submittedFrom` starts a day before the first, so the arXiv window holds that day's whole announcement;
 * Papers already stored drop out.
 */
export type CatchUp = { days: Date[]; submittedFrom: Date };

/**
 * What a Scan on `today` (`YYYY-MM-DD`) catches up on, given the date arXiv was last covered; undefined when arXiv's
 * latest announcement is enough: on the first Scan, or the day after one.
 */
export function catchUpSince(coveredThrough: string | undefined, today: string): CatchUp | undefined {
  if (coveredThrough === undefined) return undefined;
  const dates: string[] = [];
  for (let date = today; date > coveredThrough && dates.length < MAX_DAYS; date = addDays(date, -1)) dates.unshift(date);
  const [first] = dates;
  if (first === undefined || dates.length < 2) return undefined;
  return { days: dates.map(localNoon), submittedFrom: new Date(`${addDays(first, -1)}T00:00:00Z`) };
}

/** `Covers Oct 24–26.`, or `Covers Oct 30–Nov 2.` across months. */
export function coversLine({ days }: CatchUp): string {
  const [first, last] = [days[0], days.at(-1)];
  if (first === undefined || last === undefined) return "";
  const lastMonth = last.getMonth() === first.getMonth() ? "" : `${MONTHS[last.getMonth()]} `;
  return `Covers ${MONTHS[first.getMonth()]} ${first.getDate()}–${lastMonth}${last.getDate()}.`;
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function localNoon(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
