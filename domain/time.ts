/**
 * Asia/Kolkata time helpers. IST is a fixed UTC+05:30 offset (no DST), so plain
 * offset arithmetic is exact. All relative-date resolution must use the MESSAGE
 * timestamp passed in — never the device clock.
 */

export const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Calendar date (YYYY-MM-DD) in IST for an ISO instant. */
export function istDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/** Hour of day (0-23) in IST. */
export function istHour(iso: string): number {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return d.getUTCHours();
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** ISO instant for a wall-clock time in IST. */
export function istDateTime(date: string, hh = 0, mm = 0): string {
  const utc = new Date(`${date}T00:00:00Z`).getTime() + (hh * 60 + mm) * 60 * 1000 - IST_OFFSET_MS;
  return new Date(utc).toISOString();
}

/** Last instant of an IST calendar day (23:59:59). */
export function endOfIstDay(date: string): string {
  return new Date(new Date(istDateTime(date, 23, 59)).getTime() + 59 * 1000).toISOString();
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString();
}

export function lastDayOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export function isBefore(a: string, b: string): boolean {
  return new Date(a).getTime() < new Date(b).getTime();
}

export function isOnOrBefore(a: string, b: string): boolean {
  return new Date(a).getTime() <= new Date(b).getTime();
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon, 28 Sep" for a calendar date. */
export function formatDate(date: string, withWeekday = true): string {
  const [, m, d] = date.split("-").map(Number);
  const wd = WEEKDAYS[weekdayOf(date)].slice(0, 3);
  return `${withWeekday ? `${wd}, ` : ""}${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "Fri, 25 Sep · 17:30 IST" for an ISO instant. */
export function formatIst(iso: string, opts: { weekday?: boolean; time?: boolean } = {}): string {
  const { weekday = true, time = true } = opts;
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(date, weekday)}${time ? ` · ${hh}:${mm} IST` : ""}`;
}

export function daysOverdue(dueAt: string, now: string): number {
  return Math.max(0, daysBetween(istDate(dueAt), istDate(now)));
}
