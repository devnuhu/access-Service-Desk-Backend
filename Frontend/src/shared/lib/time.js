/**
 * Times are stored in UTC and always shown in WAT (UTC+1, no daylight saving), whatever the
 * browser's own time zone. Africa/Lagos is WAT all year.
 */
const WAT = "Africa/Lagos";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: WAT,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * An API time as a Date; null for no value or an invalid one. A string without a zone suffix is
 * read as UTC (the API stores UTC).
 * @param {string | Date | null | undefined} utc
 */
export function parseUtc(utc) {
  if (!utc) return null;
  const text =
    typeof utc === "string" && !/(Z|[+-]\d\d:?\d\d)$/i.test(utc)
      ? `${utc}Z`
      : utc;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether an API time has passed (false for no value or an invalid one).
 * @param {string | Date | null | undefined} utc
 * @param {number | Date} [now]
 */
export function isPast(utc, now = Date.now()) {
  const date = parseUtc(utc);
  return Boolean(date) && date.getTime() <= Number(now);
}

function watParts(date) {
  return Object.fromEntries(
    parts.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

/**
 * "2026-11-02T14:42:00Z" -> "Mon 2 Nov 2026, 15:42 WAT". Empty string for no value or an invalid one.
 * @param {string | Date | null | undefined} utc
 */
export function formatWat(utc) {
  const date = parseUtc(utc);
  if (!date) return "";
  const p = watParts(date);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} WAT`;
}

/** Whole WAT calendar days from `now` to `date` (0 today, 1 tomorrow, -1 yesterday). */
function watDayOffset(date, now) {
  const day = (d) => {
    const p = watParts(d);
    return Date.UTC(Number(p.year), MONTHS.indexOf(p.month), Number(p.day));
  };
  return Math.round((day(date) - day(now)) / 86_400_000);
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * A short WAT time for a deadline: "Today 14:00", "Tomorrow 09:30", otherwise "Thu 19 Nov, 14:00"
 * (with the year when it is not this year). Empty string for no value or an invalid one.
 * @param {string | Date | null | undefined} utc
 * @param {number | Date} [now]
 */
export function formatDueWat(utc, now = Date.now()) {
  const date = parseUtc(utc);
  if (!date) return "";
  const today = new Date(now);
  const p = watParts(date);
  const time = `${p.hour}:${p.minute}`;
  const offset = watDayOffset(date, today);
  if (offset === 0) return `Today ${time}`;
  if (offset === 1) return `Tomorrow ${time}`;
  const year = p.year === watParts(today).year ? "" : ` ${p.year}`;
  return `${p.weekday} ${p.day} ${p.month}${year}, ${time}`;
}

/**
 * "in 5 hours", "in 20 minutes", "in 2 days", "now"; a time already past reads "2 hours ago".
 * @param {string | Date | null | undefined} utc
 * @param {number | Date} [now]
 */
export function relativeText(utc, now = Date.now()) {
  const date = parseUtc(utc);
  if (!date) return "";
  const minutes = Math.floor(Math.abs(date.getTime() - Number(now)) / 60_000);
  const future = date.getTime() > Number(now);
  const amount = (n, word) => {
    const text = `${n} ${word}${n === 1 ? "" : "s"}`;
    return future ? `in ${text}` : `${text} ago`;
  };
  if (minutes < 1) return future ? "now" : "just now";
  if (minutes < 60) return amount(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return amount(hours, "hour");
  return amount(Math.floor(hours / 24), "day");
}

/**
 * "2026-11-19T13:05:00Z" -> "14:05" (WAT). Empty string for no value or an invalid one.
 * @param {string | Date | null | undefined} utc
 */
export function formatWatClock(utc) {
  const date = parseUtc(utc);
  if (!date) return "";
  const p = watParts(date);
  return `${p.hour}:${p.minute}`;
}
