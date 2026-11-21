/** On/off switch (role="switch"). Give it a visible label through `label` or aria-label. */
export default function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
  ...rest
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60"
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-brand-green" : "bg-line"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </span>
      {label}
    </button>
  );
}
