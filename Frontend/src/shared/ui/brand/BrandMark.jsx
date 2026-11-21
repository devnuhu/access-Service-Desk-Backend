import { BRAND } from "@/shared/brand";

/** "Three connected": three services joined, on light (color) or dark (light) backgrounds. */
const COLOURS = {
  color: { line: "#0B3B78", top: "#E07B00", left: "#0B3B78", right: "#4C8A1E" },
  light: { line: "#FFFFFF", top: "#FF9A1F", left: "#FFFFFF", right: "#7BC043" },
};

/**
 * The Servio mark (an inline SVG). `title` names it for screen readers; pass `decorative` when the
 * name is written next to it (it is then hidden from them).
 */
export default function BrandMark({
  size = 32,
  variant = "color",
  title = BRAND.name,
  decorative = false,
  className = "",
}) {
  const c = COLOURS[variant] ?? COLOURS.color;
  const label = decorative
    ? { "aria-hidden": "true" }
    : { role: "img", "aria-label": title };
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      data-variant={variant}
      {...label}
    >
      {!decorative && <title>{title}</title>}
      <path
        d="M32 16 L16 47 L48 47 Z"
        fill="none"
        stroke={c.line}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="16" r="8" fill={c.top} />
      <circle cx="16" cy="47" r="8" fill={c.left} />
      <circle cx="48" cy="47" r="8" fill={c.right} />
    </svg>
  );
}
