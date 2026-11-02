import { NavLink } from "react-router-dom";
import { buildNavigation } from "./navigation.js";

function Item({ item, onNavigate }) {
  const Icon = item.icon;
  if (item.comingSoon) {
    return (
      <span
        aria-disabled="true"
        className="flex cursor-not-allowed items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-muted"
      >
        <Icon aria-hidden="true" size={18} />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-page px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
          Coming soon
        </span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium ${
          isActive
            ? "bg-brand-navy-light text-brand-navy shadow-[inset_3px_0_0_var(--color-brand-orange)]"
            : "text-body hover:bg-page hover:text-ink"
        }`
      }
    >
      <Icon aria-hidden="true" size={18} />
      {item.label}
    </NavLink>
  );
}

/** The menu by role. Hiding is only for the user; the server decides access. */
export default function Sidebar({ user, onNavigate }) {
  const sections = buildNavigation(user);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 p-3">
      {sections.map((section) => (
        <div key={section.id}>
          {section.title && (
            <h2 className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
              {section.title}
            </h2>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.label}>
                <Item item={item} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
