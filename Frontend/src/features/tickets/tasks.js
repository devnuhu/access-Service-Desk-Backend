import { formatWatDateTime, formatWatDay } from "@/shared/lib/time";
import { personName } from "./ticketText.js";

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

/** Scrolls to the tasks panel and moves focus there (the resolve dialog's link, the page marker). */
export function goToTasksPanel() {
  const panel = document.getElementById(TASKS_PANEL_ID);
  panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  panel?.focus?.({ preventScroll: true });
}

/** True when resolving with this code is refused because tasks are open. */
export function tasksBlockResolve(openTasks, code) {
  if (!openTasks || code === "" || code == null) return false;
  return !MAY_LEAVE_TASKS_OPEN.includes(Number(code));
}

/** "1 task is still open. Mark it done, cancel or remove it first." (and the plural), as the API says it. */
export function openTasksText(count) {
  return count === 1
    ? "1 task is still open. Mark it done, cancel or remove it first."
    : `${count} tasks are still open. Mark them done, cancel or remove them first.`;
}

/** Tasks that stop the ticket being resolved: open ones and rejected ones (cancelled do not). */
export function blockingTasks(tasks) {
  return (tasks?.open ?? 0) + (tasks?.rejected ?? 0);
}

/** "2 open, 1 rejected, 3 done" (only the states there are; cancelled last). "" with no tasks. */
export function tasksSummary(tasks) {
  if (!tasks) return "";
  return [
    [tasks.open, "open"],
    [tasks.rejected, "rejected"],
    [tasks.done, "done"],
    [tasks.cancelled, "cancelled"],
  ]
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(", ");
}

/** The ticket page's marker: "2 tasks open, 1 rejected" ("" when nothing blocks resolving). */
export function tasksMarkerText(tasks) {
  const open = tasks?.open ?? 0;
  const rejected = tasks?.rejected ?? 0;
  const parts = [];
  if (open) parts.push(`${open} ${open === 1 ? "task" : "tasks"} open`);
  if (rejected)
    parts.push(
      open
        ? `${rejected} rejected`
        : `${rejected} ${rejected === 1 ? "task" : "tasks"} rejected`,
    );
  return parts.join(", ");
}

/** "Rejected by Name: reason" / "Cancelled by Name: reason" / "Done by Name"; "" while open. */
export function taskOutcomeText(task) {
  const by = (person) => (person ? ` by ${personName(person)}` : "");
  switch (task?.status) {
    case "Rejected":
      return `Rejected${by(task.rejectedBy)}${task.rejectedReason ? `: ${task.rejectedReason}` : ""}`;
    case "Cancelled":
      return `Cancelled${by(task.cancelledBy)}${task.cancelledReason ? `: ${task.cancelledReason}` : ""}`;
    case "Done":
      return `Done${by(task.doneBy)}`;
    default:
      return "";
  }
}

/** "2026-11-12" -> "12 Nov" (with the year when it is not this year). "" for no date. */
export function formatTaskDue(dueDate, now = Date.now()) {
  if (!dueDate) return "";
  // Noon UTC is the same calendar day in Lagos.
  return formatWatDay(`${dueDate}T12:00:00Z`, now);
}

/** "Done 24 Nov 2026, 10:00 by Name" (without "by" when the API names nobody); "" while open. */
export function doneText(task) {
  if (!task?.isDone || !task.doneAt) return "";
  const by = task.doneBy ? ` by ${personName(task.doneBy)}` : "";
  return `Done ${formatWatDateTime(task.doneAt)}${by}`;
}
