export const NO_DATA = "No data";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** Business hours: "3.5 h", "12 h"; null is "No data". */
export function formatHours(value) {
  if (value == null) return NO_DATA;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`;
}

/** "87%"; null is "No data". */
export function formatPercent(value) {
  if (value == null) return NO_DATA;
  return `${Math.round(value)}%`;
}

/** A series date by bucket: day "22 Nov", week "Week of 17 Nov", month "Nov 2026". */
export function bucketLabel(date, bucket) {
  const month = /^(\d{4})-(\d{2})$/.exec(date);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!day) return date;
  if (bucket === "month") return `${MONTHS[Number(day[2]) - 1]} ${day[1]}`;
  const text = `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]}`;
  return bucket === "week" ? `Week of ${text}` : text;
}

/** A short axis label: a week shows its Monday without "Week of". */
export function axisLabel(date, bucket) {
  return bucketLabel(date, bucket).replace(/^Week of /, "");
}

/** "1 Nov 2026 to 22 Nov 2026" for the period shown. */
export function periodText(period) {
  const day = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
  };
  const from = day(period?.from);
  const to = day(period?.to);
  if (from && to) return from === to ? from : `${from} to ${to}`;
  if (to) return `Up to ${to}`;
  return "All time";
}

/** "Critical: respond in 1 h, resolve in 4 h" for each target, most urgent first. */
export function targetsText(targets) {
  return [...targets]
    .sort((a, b) => b.priority - a.priority)
    .map(
      (t) =>
        `${t.priorityName}: respond in ${formatHours(t.responseHours)}, resolve in ${formatHours(t.resolutionHours)}`,
    );
}

/** The target used for comparison: Medium, the priority most requests get. */
export const mediumTarget = (targets) =>
  targets.find((t) => t.priority === 2) ?? null;

/** Lower is better for times: a plain verdict, or null when either figure is missing. */
export function timeVerdict(mine, team) {
  if (mine == null || team == null) return null;
  if (Math.abs(mine - team) < 0.05) return "Same as the team";
  return mine < team ? "Better than the team" : "Slower than the team";
}
