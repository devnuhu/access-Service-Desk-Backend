import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useNavigationSections } from "./useNavigation.js";

const EXACT = new Set(["/", "/availability"]);

/**
 * The one menu link to mark as the current page: the item whose link is the path, or the longest
 * one the path sits under (a page inside a deeper item marks that item, not its parent). Home and My
 * availability count only on their own page; /availability/units/... is its own item.
 */
function activeLink(sections, pathname) {
  let best = null;
  for (const item of sections.flatMap((section) => section.items)) {
    if (!item.to) continue;
    const inside = !EXACT.has(item.to) && pathname.startsWith(`${item.to}/`);
    if (
      (pathname === item.to || inside) &&
      (!best || item.to.length > best.length)
    )
      best = item.to;
  }
  return best;
}

function Item({ item, active, onNavigate }) {
  const Icon = item.icon;
  if (item.comingSoon) {
    return (
      <span
        aria-disabled="true"
        className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted"
      >
        <Icon aria-hidden="true" size={17} strokeWidth={1.75} />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
          Coming soon
        </span>
      </span>
    );
  }
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`group flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm leading-snug transition-colors ${
        active
          ? "bg-white font-semibold text-brand-navy shadow-[inset_3px_0_0_var(--color-brand-orange),0_1px_2px_rgba(11,31,58,0.06)]"
          : "text-ink hover:bg-white/70 hover:text-brand-navy"
      }`}
    >
      <Icon
        aria-hidden="true"
        size={17}
        strokeWidth={1.75}
        className="mt-px shrink-0 text-muted group-hover:text-brand-navy group-aria-[current=page]:text-brand-orange"
      />
      <span className="min-w-0 break-words">{item.label}</span>
    </Link>
  );
}

/** A titled section folds away with its heading (open by default). */
function Section({ section, activeTo, onNavigate }) {
  const [open, setOpen] = useState(true);
  const listId = `nav-${section.id}`;
  return (
    <div>
      {section.title && (
        <h2>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={listId}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-[12px] leading-snug font-semibold tracking-[0.14em] text-muted uppercase hover:text-ink"
          >
            <span className="min-w-0 break-words">{section.title}</span>
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
            />
          </button>
        </h2>
      )}
      {section.title && section.subtitle && (
        <p className="px-3 text-xs leading-snug text-muted">
          {section.subtitle}
        </p>
      )}
      <ul id={listId} hidden={!open} className="mt-1 space-y-0.5">
        {section.items.map((item) => (
          <li key={item.label}>
            <Item
              item={item}
              active={item.to === activeTo}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The menu by role and by the person's place in the organisation (GET /api/org/me). Hiding is only
 * for the user; the server decides access.
 */
export default function Sidebar({ user, onNavigate }) {
  const sections = useNavigationSections(user);
  const { pathname } = useLocation();
  const activeTo = activeLink(sections, pathname);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          activeTo={activeTo}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
