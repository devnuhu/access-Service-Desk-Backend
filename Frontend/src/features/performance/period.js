/** The period choices (This week is not offered). Custom dates use from and to. */
export const PERIODS = [
  ["today", "Today"],
  ["last7", "Last 7 days"],
  ["thismonth", "This month"],
  ["lastmonth", "Last month"],
  ["thisquarter", "This quarter"],
  ["thisyear", "This year"],
  ["all", "All time"],
  ["custom", "Custom dates"],
];

export const DEFAULT_PERIOD = { preset: "thismonth", from: "", to: "" };
const KEY = "asd.performance.period";

/** The last choice, kept for this browser tab while navigating. */
export function readPeriod() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (saved && PERIODS.some(([key]) => key === saved.preset))
      return { ...DEFAULT_PERIOD, ...saved };
  } catch {
    // Storage blocked or garbled: the default period.
  }
  return DEFAULT_PERIOD;
}

export function storePeriod(period) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(period));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The query for a period: from and to for custom dates, else the preset. */
export function periodQuery({ preset, from, to }) {
  return preset === "custom" ? { from, to } : { preset };
}
