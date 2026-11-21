import { SLA_LEVEL } from "../api/endpoints.js";

const LEVELS = {
  [SLA_LEVEL.Warning]: ["text-brand-orange-ink", "bg-brand-orange", "Warning"],
  [SLA_LEVEL.Overdue]: ["text-danger", "bg-danger", "Overdue"],
  [SLA_LEVEL.FarPast]: [
    "text-danger",
    "bg-danger ring-2 ring-danger/25",
    "Far past",
  ],
};

/**
 * Warning (amber), Overdue (red) or Far past (red, ringed dot): a dot and a word, so a row can carry
 * it without another pill. Nothing while on track. The API sends the level only; requesters and
 * finished tickets always get OnTrack.
 */
export default function SlaBadge({ level }) {
  const badge = LEVELS[level];
  if (!badge) return null;
  const [text, dot, label] = badge;
  return (
    <span
      data-testid="sla-badge"
      data-level={level}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${text}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
