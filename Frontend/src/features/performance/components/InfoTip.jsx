import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * A small "i" with help text, shown on hover, on focus and on a tap (for phones). `text` is a
 * string or a list of lines.
 */
export default function InfoTip({ text, label = "About this figure" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const lines = Array.isArray(text) ? text : [text];
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="rounded-full p-0.5 text-muted hover:text-brand-navy"
      >
        <Info aria-hidden="true" size={14} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`absolute top-full left-1/2 z-30 mt-1 w-60 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-normal text-body shadow-lg ${open ? "" : "sr-only"}`}
      >
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}
