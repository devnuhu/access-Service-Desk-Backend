import { useId, useState } from "react";
import { PERIODS } from "../period.js";

const field =
  "h-9 rounded-lg border border-line bg-white px-2.5 text-sm text-ink";

/**
 * The period: a preset, or Custom dates (from and to, applied once both are set and in order).
 * `value` { preset, from, to }; `onChange` receives the next value.
 */
export default function PeriodPicker({ value, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const wrong = draft.from && draft.to && draft.from > draft.to;

  const setDate = (name) => (event) => {
    const next = { ...draft, [name]: event.target.value };
    setDraft(next);
    if (next.from && next.to && next.from <= next.to)
      onChange({ preset: "custom", ...next });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label
          htmlFor={`${id}-preset`}
          className="block text-xs font-semibold text-muted"
        >
          Period
        </label>
        <select
          id={`${id}-preset`}
          value={value.preset}
          onChange={(event) =>
            onChange({ ...value, preset: event.target.value })
          }
          className={`mt-0.5 ${field}`}
        >
          {PERIODS.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </div>
      {value.preset === "custom" && (
        <>
          <div>
            <label
              htmlFor={`${id}-from`}
              className="block text-xs font-semibold text-muted"
            >
              From
            </label>
            <input
              id={`${id}-from`}
              type="date"
              value={draft.from}
              onChange={setDate("from")}
              aria-invalid={wrong ? "true" : undefined}
              aria-describedby={wrong ? `${id}-error` : undefined}
              className={`mt-0.5 ${field}`}
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-to`}
              className="block text-xs font-semibold text-muted"
            >
              To
            </label>
            <input
              id={`${id}-to`}
              type="date"
              value={draft.to}
              onChange={setDate("to")}
              aria-invalid={wrong ? "true" : undefined}
              aria-describedby={wrong ? `${id}-error` : undefined}
              className={`mt-0.5 ${field}`}
            />
          </div>
          {wrong && (
            <p
              id={`${id}-error`}
              className="w-full text-xs font-medium text-danger"
            >
              The start date must be on or before the end date.
            </p>
          )}
        </>
      )}
    </div>
  );
}
