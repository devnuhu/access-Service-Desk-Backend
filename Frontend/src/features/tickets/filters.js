import { PRIORITY_LABELS } from "@/features/catalogue";

/**
 * The ticket list's priority and age filters (GET /api/tickets ?priority= and ?ageBand=), and
 * the dashboard's chart labels mapped to them. The API's charts send labels only, so a label maps
 * back by its text; anything unknown gives null.
 */

/** 1 Low, 2 Medium, 3 High, 4 Critical (the catalogue's labels). */
export { PRIORITY_LABELS };

/** How long ago an open ticket was raised: exactly the bars of the unit chart "Open by age". */
export const AGE_BANDS = Object.freeze([
  { id: 1, label: "Under 1 day" },
  { id: 2, label: "1 to 2 days" },
  { id: 3, label: "3 to 5 days" },
  { id: 4, label: "6 to 10 days" },
  { id: 5, label: "Over 10 days" },
]);

const norm = (text) =>
  String(text ?? "")
    .trim()
    .toLowerCase();

/** "Critical" -> 4; unknown -> null. */
export function priorityFromLabel(label) {
  const hit = Object.entries(PRIORITY_LABELS).find(
    ([, name]) => norm(name) === norm(label),
  );
  return hit ? Number(hit[0]) : null;
}

/** "Over 10 days" -> 5; unknown -> null. */
export function ageBandFromLabel(label) {
  return AGE_BANDS.find((band) => norm(band.label) === norm(label))?.id ?? null;
}

/** 4 -> "Critical"; unknown -> null. */
export const priorityLabel = (value) => PRIORITY_LABELS[Number(value)] ?? null;

/** 5 -> "Over 10 days"; unknown -> null. */
export const ageBandLabel = (value) =>
  AGE_BANDS.find((band) => band.id === Number(value))?.label ?? null;

/** An address value ("3") as a filter value: the text when it is a known one, otherwise "". */
export const readPriority = (value) =>
  value != null && priorityLabel(value) ? String(Number(value)) : "";
export const readAgeBand = (value) =>
  value != null && ageBandLabel(value) ? String(Number(value)) : "";

/** Critical first, as the select lists them. */
export const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => Number(b.value) - Number(a.value));
