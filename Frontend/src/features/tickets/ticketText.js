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
