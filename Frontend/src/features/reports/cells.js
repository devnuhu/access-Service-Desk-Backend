import { formatWat, formatWatClock } from "@/shared/lib/time";

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export const NUMERIC_TYPES = ["number", "percent", "hours"];

/** A row's value for column `index`: rows (and totals) list their values in column order. */
export function cellValue(row, column, index) {
  return row?.[index];
}

/** "2026-11-19" -> "19 Nov 2026" (a Lagos date: no time zone to convert). */
function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * One cell as text, by the column's type. Datetimes are UTC and shown in Lagos time (WAT). A
 * percent has a decimal only when it needs one ("87%", "87.5%"), and an empty one reads "-"
 * (nothing to measure yet, for example responded in time with no tickets).
 */
export function formatCell(value, type) {
  if (value === null || value === undefined || value === "")
    return type === "percent" ? "-" : "";
  const isNumber = typeof value === "number";
  switch (type) {
    case "number":
      return isNumber ? number.format(value) : String(value);
    case "percent":
      return isNumber ? `${number.format(value)}%` : String(value);
    case "hours":
      return isNumber ? `${oneDecimal.format(value)} h` : String(value);
    case "date":
      return formatDate(value);
    case "datetime":
      return formatWat(value) || String(value);
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

/** "Run at 14:05" (Lagos time). */
export function formatRunAt(utc) {
  const time = formatWatClock(utc);
  return time ? `Run at ${time}` : "";
}
