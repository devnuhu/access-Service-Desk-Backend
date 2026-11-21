import Spinner from "./Spinner.jsx";

const VARIANTS = {
  // Navy with a 3px orange bottom edge, as in the app's emails.
  primary:
    "bg-brand-navy text-white border-b-[3px] border-brand-orange hover:bg-brand-navy-dark disabled:bg-brand-navy/60",
  secondary:
    "bg-white text-brand-navy border border-line hover:bg-brand-navy-light disabled:text-muted",
  danger:
    "bg-white text-danger border border-danger hover:bg-danger-light disabled:opacity-60",
  ghost: "bg-transparent text-brand-navy hover:bg-brand-navy-light",
  // Orange for an action only staff see (an internal note).
  internal:
    "bg-brand-orange text-white border-b-[3px] border-brand-orange-ink hover:bg-brand-orange-ink disabled:bg-brand-orange/60",
};

const SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  busy = false,
  busyText,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy ? (
        <>
          <Spinner size={16} />
          {busyText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
