const base =
  "rounded-card border bg-white px-5 py-4 text-left shadow-card transition-colors";

/**
 * A label and a figure. `tone` (with its `dot`) only colours a figure above 0: a 0 reads as calm,
 * not as an alarm.
 */
function Count({ label, value, tone, dot }) {
  const alert = Boolean(tone) && typeof value === "number" && value > 0;
  return (
    <>
      <span className="flex items-center gap-2 text-sm font-medium text-muted">
        {dot && (
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${alert ? dot : "bg-line"}`}
          />
        )}
        {label}
      </span>
      <span
        className={`mt-2 block text-3xl font-semibold tracking-tight tabular-nums ${alert ? tone : "text-ink"}`}
      >
        {value}
      </span>
    </>
  );
}

/**
 * Open, Warning, Overdue, Far past and Unassigned for the queue in view (each open ticket counted
 * once, at its highest level). Overdue and Unassigned are buttons that filter the list below.
 */
export default function SlaSummary({
  query,
  overdueOn,
  unassignedOn,
  onOverdue,
  onUnassigned,
}) {
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {query.error.message}
      </p>
    );
  }
  const data = query.data;
  const value = (field) => (data ? data[field] : "…");
  const button = (pressed) =>
    `${base} cursor-pointer ${pressed ? "border-brand-navy ring-2 ring-brand-navy/30" : "border-line hover:border-brand-navy/40"}`;

  return (
    <section
      aria-label="Deadlines"
      data-testid="sla-summary"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <div className={`${base} border-line`}>
        <Count label="Open" value={value("open")} />
      </div>
      <div className={`${base} border-line`}>
        <Count
          label="Warning"
          value={value("warning")}
          tone="text-brand-orange-ink"
          dot="bg-brand-orange"
        />
      </div>
      <button
        type="button"
        aria-pressed={overdueOn}
        onClick={onOverdue}
        className={button(overdueOn)}
      >
        <Count
          label="Overdue"
          value={value("overdue")}
          tone="text-danger"
          dot="bg-danger"
        />
      </button>
      <div className={`${base} border-line`}>
        <Count
          label="Far past"
          value={value("farPast")}
          tone="text-danger"
          dot="bg-danger"
        />
      </div>
      <button
        type="button"
        aria-pressed={unassignedOn}
        onClick={onUnassigned}
        className={button(unassignedOn)}
      >
        <Count label="Unassigned" value={value("unassigned")} />
      </button>
    </section>
  );
}
