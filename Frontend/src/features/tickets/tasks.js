import { formatWatDay } from "@/shared/lib/time";

/** ResolutionCode values that may resolve a ticket while tasks are still open (the API agrees). */
export const RESOLUTION_CODE = Object.freeze({
  Duplicate: 4,
  RaisedInError: 6,
});
const MAY_LEAVE_TASKS_OPEN = [
  RESOLUTION_CODE.Duplicate,
  RESOLUTION_CODE.RaisedInError,
];

/** The id of the tasks panel on the ticket page (the resolve dialog links to it). */
export const TASKS_PANEL_ID = "ticket-tasks";

/** True when resolving with this code is refused because tasks are open. */
export function tasksBlockResolve(openTasks, code) {
  if (!openTasks || code === "" || code == null) return false;
  return !MAY_LEAVE_TASKS_OPEN.includes(Number(code));
}

/** "1 task is still open. Mark it done or remove it first." (and the plural). */
export function openTasksText(count) {
  return count === 1
    ? "1 task is still open. Mark it done or remove it first."
    : `${count} tasks are still open. Mark them done or remove them first.`;
}

/** "2026-11-12" -> "12 Nov" (with the year when it is not this year). "" for no date. */
export function formatTaskDue(dueDate, now = Date.now()) {
  if (!dueDate) return "";
  // Noon UTC is the same calendar day in Lagos.
  return formatWatDay(`${dueDate}T12:00:00Z`, now);
}
