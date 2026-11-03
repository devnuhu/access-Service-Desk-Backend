import { formatDay, formatShortDay } from "@/shared/lib/dates";
import { ABSENCE_KIND } from "./api/endpoints.js";

export function kindLabel(kind) {
  return kind === ABSENCE_KIND.OutOfOffice ? "Out of office" : "Leave";
}

/** "On leave until Thu 5 Nov 2026" / "Out of office until …"; short: "On leave until 5 Nov". */
export function awayUntil(absence, { short = false } = {}) {
  const until = short
    ? formatShortDay(absence.endDate)
    : formatDay(absence.endDate);
  return absence.kind === ABSENCE_KIND.OutOfOffice
    ? `Out of office until ${until}`
    : `On leave until ${until}`;
}

/** A period that has started (today is the API's office date) ends early; a future one is cancelled. */
export function hasStarted(absence, today) {
  return absence.startDate <= today;
}
