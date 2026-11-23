import { formatWatDay, parseUtc, watDaysSince } from "@/shared/lib/time";
import { PENDING_REASON } from "./api/endpoints.js";

/**
 * How long a Pending ticket has waited, in WAT calendar days from pendingSince. The colour steps
 * match the backend's reminder steps (stepSD-pending-reminders): change them here only.
 */
export const PENDING_WAIT_DAYS = Object.freeze({
  /** From this many days the wait shows amber. */
  amber: 5,
  /** From this many days the wait shows red. */
  red: 10,
});

/** Oldest pendingSince first; tickets without one last. */
export function oldestWaitingFirst(tickets) {
  const at = (t) => parseUtc(t.pendingSince)?.getTime() ?? Infinity;
  return tickets
    .map((ticket, index) => [at(ticket), index, ticket])
    .sort(([a, i], [b, j]) => (a === b ? i - j : a < b ? -1 : 1))
    .map(([, , ticket]) => ticket);
}

/** "neutral" (up to 4 days), "amber" (from 5) or "red" (from 10). */
export function waitTone(days) {
  if (days >= PENDING_WAIT_DAYS.red) return "red";
  if (days >= PENDING_WAIT_DAYS.amber) return "amber";
  return "neutral";
}

/** 0 -> "today", 1 -> "1 day", 5 -> "5 days". */
export function daysText(days) {
  if (!days) return "today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Whom it waits on, in the ticket page's words: "you" for the requester themself. */
export function waitingOnText(reason, { isRequester = false } = {}) {
  if (reason !== PENDING_REASON.Requester) return "a third party";
  return isRequester ? "you" : "the requester";
}

/**
 * The ticket page's line: "Waiting on you since 12 Nov (5 days)". Null without a pendingSince.
 * @param {{ pendingReason: number | null, pendingSince: string | null }} ticket
 */
export function waitingLine(
  ticket,
  { isRequester = false, now = Date.now() } = {},
) {
  const days = watDaysSince(ticket.pendingSince, now);
  if (days == null) return null;
  const who = waitingOnText(ticket.pendingReason, { isRequester });
  return {
    text: `Waiting on ${who} since ${formatWatDay(ticket.pendingSince, now)} (${daysText(days)})`,
    days,
    tone: waitTone(days),
  };
}

/**
 * The list chip's words: "Waiting on requester · 5d" or "Waiting on third party · 5d"; with `you`
 * (the requester's own list) "Waiting on you · 5d".
 */
export function waitChipText(reason, days, { you = false } = {}) {
  const who =
    reason === PENDING_REASON.Requester
      ? you
        ? "you"
        : "requester"
      : "third party";
  return `Waiting on ${who} · ${days}d`;
}
