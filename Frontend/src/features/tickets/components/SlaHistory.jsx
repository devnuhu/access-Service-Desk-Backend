import { formatWat } from "@/shared/lib/time";

const STEPS = [
  ["slaWarnedAt", "Warning sent"],
  ["slaBreachedAt", "Marked overdue"],
  ["slaL2At", "Reported to the Head of Department"],
];

/** Staff only: when the SLA clock warned, marked the ticket overdue and told the HOD. */
export default function SlaHistory({ ticket }) {
  const steps = STEPS.filter(([field]) => ticket[field]);
  if (!steps.length) return null;
  return (
    <section aria-labelledby="sla-history-heading" data-testid="sla-history">
      <h3 id="sla-history-heading" className="text-sm font-semibold text-ink">
        Deadline alerts
      </h3>
      <ol className="mt-2 space-y-1.5 text-sm">
        {steps.map(([field, label]) => (
          <li key={field}>
            <span className="text-ink">{label}</span>
            <span className="block text-xs text-muted">
              {formatWat(ticket[field])}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
