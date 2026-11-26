import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { ChevronRight, Menu, X } from "lucide-react";
import { NotificationBell } from "@/features/notifications";
import { useSession } from "@/features/auth";
import { BRAND } from "@/shared/brand";
import useDocumentTitle from "@/shared/hooks/useDocumentTitle";
import { BrandLockup, PageContext } from "@/shared/ui";
import Sidebar from "./Sidebar.jsx";
import UserMenu from "./UserMenu.jsx";
import {
  describePlace,
  findPlace,
  useNavigationSections,
} from "./useNavigation.js";

const BAR = "h-16";

function Breadcrumbs({ crumbs }) {
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-2 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              key={`${i}-${crumb.label}`}
              className="flex min-w-0 items-center gap-2"
            >
              {i > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  size={16}
                  className="shrink-0 text-muted"
                />
              )}
              {last ? (
                <span
                  aria-current="page"
                  className="truncate font-semibold text-ink"
                >
                  {crumb.label}
                </span>
              ) : crumb.to ? (
                <Link
                  to={crumb.to}
                  className="truncate text-muted hover:text-brand-navy hover:underline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-muted">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Soft blue-grey sidebar with the brand, the menu and the footer (a drawer under 1024px); a white top bar
 * with the breadcrumb trail, notifications and the account menu; pages on the page colour. Each
 * page's PageHeader gets its eyebrow from here and gives back its title for the trail.
 */
export default function AppLayout() {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [header, setHeader] = useState(null);
  const sections = useNavigationSections(user);
  const place = describePlace(findPlace(sections, pathname), header);
  const page = useMemo(
    () => ({ eyebrow: place.eyebrow, setHeader }),
    [place.eyebrow],
  );

  // The browser tab: "Access Desk" on Home, "<Page> · Access Desk" elsewhere.
  useDocumentTitle(pathname === "/" ? null : (header?.title ?? null));

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="flex min-h-screen bg-page">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-navy focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {menuOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
        }`}
      >
        <div
          className={`flex ${BAR} shrink-0 items-center border-b border-line px-5`}
        >
          <Link
            to="/"
            onClick={() => setMenuOpen(false)}
            aria-label={`${BRAND.name} dashboard`}
          >
            <BrandLockup />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar user={user} onNavigate={() => setMenuOpen(false)} />
        </div>
        <p className="shrink-0 border-t border-line px-5 py-4 text-xs text-muted">
          © {new Date().getFullYear()} {BRAND.legalName}. All rights reserved.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`sticky top-0 z-20 flex ${BAR} shrink-0 items-center gap-3 border-b border-line/70 bg-page/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-page/70 sm:px-8 lg:px-12`}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="rounded-lg p-2 text-ink hover:bg-page lg:hidden"
          >
            {menuOpen ? (
              <X aria-hidden="true" size={20} />
            ) : (
              <Menu aria-hidden="true" size={20} />
            )}
          </button>
          <span className="md:hidden">
            <BrandLockup size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <Breadcrumbs crumbs={place.crumbs} />
          </div>
          <NotificationBell />
          <span
            aria-hidden="true"
            className="hidden h-8 w-px bg-line sm:block"
          />
          <UserMenu user={user} />
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12"
        >
          <PageContext.Provider value={page}>
            <div key={pathname} className="page-in">
              <Outlet />
            </div>
          </PageContext.Provider>
          <ScrollRestoration />
        </main>
      </div>
    </div>
  );
}
