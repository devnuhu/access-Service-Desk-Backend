const TONES = {
  navy: "bg-brand-navy-light text-brand-navy",
  green: "bg-brand-green-light text-brand-green-ink",
  orange: "bg-brand-orange-light text-brand-orange-ink",
  red: "bg-danger-light text-danger",
  grey: "bg-page text-body border border-line",
};

/** Small rounded uppercase label (roles, active/blocked). */
export default function Chip({
  tone = "navy",
  className = "",
  children,
  ...rest
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
