import { STATUS, STATUS_LABELS } from "./api/endpoints.js";

/** Status chip classes: New grey, Assigned navy, In progress light navy, Pending orange, ... */
export const STATUS_STYLE = {
  [STATUS.New]: "bg-page text-body border border-line",
  [STATUS.Assigned]: "bg-brand-navy text-white",
  [STATUS.InProgress]: "bg-brand-navy-light text-brand-navy",
  [STATUS.Pending]: "bg-brand-orange-light text-brand-orange-ink",
  [STATUS.Resolved]: "bg-brand-green-light text-brand-green-ink",
  [STATUS.Reopened]: "bg-brand-orange-light text-brand-orange-ink",
  [STATUS.Closed]: "bg-page text-body border border-line",
  [STATUS.Cancelled]: "bg-page text-muted border border-line line-through",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? "Unknown";
}

export function personName(person) {
  if (!person) return "";
  return person.fullName || person.userName;
}

const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "2 days ago" (by time elapsed). */
export function ageText(utc, now = Date.now()) {
  const text = /(Z|[+-]\d\d:?\d\d)$/i.test(utc) ? utc : `${utc}Z`;
  const days = Math.floor((now - new Date(text).getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The session-storage key of a person's ticket draft. */
export function draftKey(userId) {
  return `sd-ticket-draft:${userId}`;
}

/** Most people a ticket can copy. */
export const MAX_CC = 10;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function sinceText(utc, now = Date.now()) {
  const text = /(Z|[+-]\d\d:?\d\d)$/i.test(utc) ? utc : `${utc}Z`;
  const minutes = Math.floor((now - new Date(text).getTime()) / 60_000);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/** Why the engine assigned it, in plain words (the reason of an Auto history entry). */
const AUTO_REASONS = {
  raised: "When it was raised",
  retry: "When someone became available",
  "assignee unavailable": "Because the assignee was unavailable",
  "reopened while the assignee is unavailable":
    "When it was reopened and the assignee was unavailable",
};

export function autoReasonText(reason) {
  return AUTO_REASONS[reason] ?? reason;
}

/** A 409 on any ticket change. */
export const TICKET_CONFLICT =
  "The ticket changed at the same moment. It has been reloaded.";

/**
 * The bold label a workflow comment (kind 1) starts with: "Resolved: Completed", "Escalated to the
 * head of unit", ... The system writes it; nothing else in the body is read.
 */
export function workflowLabel(comment) {
  return (
    comment.bodyHtml.match(/^<p><strong>([^<]+)<\/strong><\/p>/)?.[1] ?? null
  );
}

/** The body of a workflow comment without its label. */
export function workflowBody(comment) {
  return comment.bodyHtml.replace(/^<p><strong>[^<]+<\/strong><\/p>/, "");
}

/** Escalation reasons: 5 to 1000 characters. */
export const ESCALATE_MAX = 1000;

/** Reassignment reasons: 5 to 500 characters. */
export const REASON_MIN = 5;
export const REASON_MAX = 500;
