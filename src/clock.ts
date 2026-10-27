/** The time seam: Scans read the time only through it, so tests pin the day. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` in the system time zone. */
export function localDate(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `Mon 26 Oct 2026` in the system time zone. */
export function longDate(at: Date): string {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

export function localTime(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** `26 Oct` in the system time zone. */
export function dayAndMonth(at: Date): string {
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** An ISO week: named `YYYY-Www` by its ISO week-year, from local midnight on its Monday to its Sunday. */
export type IsoWeek = { name: string; monday: Date; sunday: Date };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The ISO week, in the system time zone, before the one `at` falls in. */
export function lastWeek(at: Date): IsoWeek {
  const thisMonday = mondayOf(at);
  return isoWeek(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7));
}

function isoWeek(at: Date): IsoWeek {
  const monday = mondayOf(at);
  const year = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3).getFullYear();
  const week = 1 + Math.round((monday.getTime() - mondayOf(new Date(year, 0, 4)).getTime()) / WEEK_MS);
  return { name: `${year}-W${pad(week)}`, monday, sunday: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
}

function mondayOf(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - ((at.getDay() + 6) % 7));
}
