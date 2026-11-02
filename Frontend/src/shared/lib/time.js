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
 * "2026-11-02T14:42:00Z" -> "Mon 2 Nov 2026, 15:42 WAT". Empty string for no value or an invalid one.
 * A string without a zone suffix is read as UTC (the API stores UTC).
 * @param {string | Date | null | undefined} utc
 */
export function formatWat(utc) {
  if (!utc) return "";
  const text =
    typeof utc === "string" && !/(Z|[+-]\d\d:?\d\d)$/i.test(utc)
      ? `${utc}Z`
      : utc;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(
    parts.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} WAT`;
}
