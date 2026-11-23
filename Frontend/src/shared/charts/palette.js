/**
 * Chart colours by meaning: one colour per measure everywhere, never by rank or position. The
 * values are CSS variables (src/index.css), so a dark theme swaps them in one place.
 */
export const MEASURE_COLOR = Object.freeze({
  assigned: "var(--viz-assigned)",
  raised: "var(--viz-raised)",
  resolved: "var(--viz-resolved)",
  open: "var(--viz-open)",
  onHold: "var(--viz-open)",
  within: "var(--viz-within)",
  tickets: "var(--viz-neutral)",
});

/** Priority, as PriorityChip shows it: Low grey, Medium navy, High orange, Critical red. */
export const PRIORITY_COLOR = Object.freeze({
  Low: "#8a96a8",
  Medium: "#003883",
  High: "#ff8200",
  Critical: "#b42318",
});

/**
 * Ordered categories (ticket stages, ticket age): one blue hue from light to dark, so the order
 * reads without a legend. Every bar is labelled as well.
 */
export const STEPS = [
  "var(--viz-step-1)",
  "var(--viz-step-2)",
  "var(--viz-step-3)",
  "var(--viz-step-4)",
  "var(--viz-step-5)",
  "var(--viz-step-6)",
];

/** The step for item `index` of `count`, spread over the ramp (light first). */
export function stepColor(index, count) {
  if (count <= 1) return STEPS[3];
  const at = Math.round((index * (STEPS.length - 1)) / (count - 1));
  return STEPS[Math.min(STEPS.length - 1, at)];
}

/** The second channel for "On hold" (never colour alone): 45° stripes over the fill. */
export const HATCH =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 6px)";
