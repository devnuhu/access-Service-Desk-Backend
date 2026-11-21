const WEEKDAYS = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "2027-01-01" -> "Fri 1 Jan 2027" (a calendar date: no time zone). */
export function formatHolidayDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return value ?? "";
  const [year, month, day] = match.slice(1).map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]} ${year}`;
}
