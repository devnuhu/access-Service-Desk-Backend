import InfoTip from "./InfoTip.jsx";

/** A headline figure: label with its help, and the value ("No data" quieter). */
export default function Figure({ label, value, help, testId }) {
  const missing = value === "No data";
  return (
    <li className="flex h-full flex-col justify-between gap-2 rounded-card border border-line bg-white px-4 py-3.5 shadow-card">
      <span className="flex items-center gap-1 text-sm text-muted">
        {label}
        {help && <InfoTip text={help} label={`About ${label}`} />}
      </span>
      <span
        data-testid={testId}
        className={
          missing
            ? "text-base font-medium text-muted"
            : "text-2xl font-semibold text-ink tabular-nums sm:text-3xl"
        }
      >
        {value}
      </span>
    </li>
  );
}
