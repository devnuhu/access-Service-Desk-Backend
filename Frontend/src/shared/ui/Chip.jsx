/** Soft tinted fill with a hairline outline: calm enough to sit several to a row. */
const TONES = {
  navy: "bg-brand-navy-light text-brand-navy ring-brand-navy/15",
  green: "bg-brand-green-light text-brand-green-ink ring-brand-green-ink/20",
  orange:
    "bg-brand-orange-light text-brand-orange-ink ring-brand-orange-ink/20",
  red: "bg-danger-light text-danger ring-danger/20",
  // The strongest state (Far past): stronger outline and weight, still no solid block.
  darkRed: "bg-danger-light text-danger font-semibold ring-danger/50",
  grey: "bg-page text-body ring-line",
};

/** A small label (roles, states, on/off). Sentence case; the text is the label as written. */
export default function Chip({
  tone = "navy",
  className = "",
  children,
  ...rest
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
