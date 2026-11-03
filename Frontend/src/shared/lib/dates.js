/**
 * Office days as "yyyy-MM-dd" strings (leave, and SLA working days later), Lagos time (rule 16).
 * They are calendar dates, not instants: they are split into numbers and handled with UTC date
 * arithmetic, so the browser's time zone never moves a day. Never pass them through
 * new Date("yyyy-MM-dd") and local getters. Instants (recordedAt, joinedAt) use formatWat.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;

/** "2026-11-03" -> { y: 2026, m: 11, d: 3 }; throws on anything else. */
export function parseDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  if (!match) throw new Error(`Not a yyyy-MM-dd date: "${day}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Days since 1970-01-01 for a calendar date (no time zone involved). */
function dayNumber(day) {
  const { y, m, d } = parseDay(day);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n) {
  const date = new Date(n * DAY_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekday(day) {
  return WEEKDAYS[new Date(dayNumber(day) * DAY_MS).getUTCDay()];
}

/** "2026-11-03" -> "Tue 3 Nov 2026" */
export function formatDay(day) {
  const { y, m, d } = parseDay(day);
  return `${weekday(day)} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-11-05" -> "5 Nov" (for compact tables) */
export function formatShortDay(day) {
  const { m, d } = parseDay(day);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Mon 9 Nov – Fri 13 Nov 2026"; the year is shown once unless the range crosses one. */
export function formatRange(start, end) {
  if (start === end) return formatDay(start);
  const a = parseDay(start);
  const b = parseDay(end);
  const left = `${weekday(start)} ${a.d} ${MONTHS[a.m - 1]}`;
  return a.y === b.y
    ? `${left} – ${formatDay(end)}`
    : `${left} ${a.y} – ${formatDay(end)}`;
}

/** "9–13 Nov", "30 Nov – 2 Dec", "9 Nov" (compact, no weekday or year). */
export function formatShortRange(start, end) {
  if (start === end) return formatShortDay(start);
  const a = parseDay(start);
  const b = parseDay(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]}`;
  return `${formatShortDay(start)} – ${formatShortDay(end)}`;
}

/** Calendar days from start to end, both included. */
export function daysInclusive(start, end) {
  return dayNumber(end) - dayNumber(start) + 1;
}

/** The day n days after (or before, n < 0) the given one. */
export function addDays(day, n) {
  return fromDayNumber(dayNumber(day) + n);
}

/** Compares two days as strings; "yyyy-MM-dd" sorts in date order. */
export function isOnOrBefore(a, b) {
  return a <= b;
}
