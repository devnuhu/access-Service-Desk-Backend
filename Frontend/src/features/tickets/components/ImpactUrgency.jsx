import { PriorityChip } from "@/features/catalogue";

/** One question as a row of selectable cards (radio buttons underneath). */
function ChoiceCards({ name, legend, choices, value, onChange, error }) {
  const errorId = `ticket-${name}-error`;
  return (
    <fieldset data-field={name} aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`relative flex cursor-pointer flex-col rounded-lg border bg-white px-3 py-2.5 transition-colors hover:border-brand-navy/50 has-checked:border-brand-navy has-checked:bg-brand-navy-light has-checked:ring-1 has-checked:ring-brand-navy has-focus-visible:ring-2 has-focus-visible:ring-brand-navy ${error ? "border-danger" : "border-line"}`}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            <span className="text-sm font-semibold text-ink">
              {choice.label}
            </span>
            {choice.description && (
              <span className="mt-0.5 text-xs text-muted">
                {choice.description}
              </span>
            )}
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * "Who does this affect?" and "How urgent is it?", then the priority the matrix gives the pair
 * (read-only; hidden while either is unanswered or when the matrix could not be loaded).
 */
export default function ImpactUrgency({
  impacts,
  urgencies,
  impact,
  urgency,
  onChange,
  errors,
  priority,
}) {
  return (
    <div className="space-y-4">
      <ChoiceCards
        name="impact"
        legend="Who does this affect?"
        choices={impacts}
        value={impact}
        onChange={(value) => onChange({ impact: value })}
        error={errors.impact}
      />
      <ChoiceCards
        name="urgency"
        legend="How urgent is it?"
        choices={urgencies}
        value={urgency}
        onChange={(value) => onChange({ urgency: value })}
        error={errors.urgency}
      />
      <p
        data-testid="priority-preview"
        aria-live="polite"
        className="flex min-h-6 flex-wrap items-center gap-1.5 text-sm text-body"
      >
        {priority && (
          <>
            We will treat this as <PriorityChip priority={priority} /> priority.
          </>
        )}
      </p>
    </div>
  );
}
