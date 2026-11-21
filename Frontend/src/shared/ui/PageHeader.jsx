import { useEffect } from "react";
import { usePageContext } from "./pageContext.js";

/**
 * The top of every page: a small green eyebrow behind a short orange rule (where the page sits; by default from the menu),
 * a large navy title, a line saying what the page is for, and the page's actions on the right.
 * The title also ends the breadcrumb trail in the top bar (`crumb` when the title is not text);
 * `trail` ([{ label, to? }]) replaces the part between the menu section and the title when the
 * page sits deeper than the menu knows (a unit's skills: Units > department > unit).
 */
export default function PageHeader({
  title,
  crumb,
  trail,
  eyebrow,
  description,
  actions,
  children,
}) {
  const page = usePageContext();
  const setHeader = page?.setHeader;
  const label = crumb ?? (typeof title === "string" ? title : null);
  // Compared as text: a trail written inline is a new array on every render.
  const trailKey = trail ? JSON.stringify(trail) : null;

  useEffect(() => {
    if (!setHeader) return undefined;
    setHeader({
      title: label,
      trail: trailKey ? JSON.parse(trailKey) : null,
    });
    return () => setHeader(null);
  }, [setHeader, label, trailKey]);

  const kicker = eyebrow ?? page?.eyebrow;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {kicker && (
          <p className="flex items-center gap-2.5 text-xs font-bold tracking-[0.14em] text-brand-green-text uppercase">
            <span
              aria-hidden="true"
              className="h-0.5 w-6 shrink-0 rounded-full bg-brand-orange"
            />
            {kicker}
          </p>
        )}
        <h1 className="mt-2 text-2xl font-normal tracking-tight text-brand-navy sm:text-[2rem] sm:leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm text-muted">{description}</p>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
