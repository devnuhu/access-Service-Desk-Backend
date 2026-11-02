import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { NotificationBell } from "@/features/notifications";
import { useSession } from "@/features/auth";
import { BrandLockup } from "@/shared/ui";
import Sidebar from "./Sidebar.jsx";
import UserMenu from "./UserMenu.jsx";

/** Navy top bar, white sidebar (a drawer under 1024px), content on the page colour. */
export default function AppLayout() {
  const { user } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-page">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 text-sm font-semibold text-brand-navy focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-brand-navy px-3 sm:px-5">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="rounded-[6px] p-2 text-white hover:bg-white/10 lg:hidden"
        >
          {menuOpen ? (
            <X aria-hidden="true" size={20} />
          ) : (
            <Menu aria-hidden="true" size={20} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <span className="hidden sm:inline-flex">
            <BrandLockup logoHeight={28} />
          </span>
          <span className="sm:hidden">
            <span className="text-lg font-bold text-white">
              Access <span className="text-brand-green">Desk</span>
            </span>
          </span>
        </div>
        <NotificationBell />
        <UserMenu user={user} />
      </header>

      <div className="flex">
        {menuOpen && (
          <div
            aria-hidden="true"
            className="fixed inset-0 top-14 z-20 bg-ink/30 lg:hidden"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside
          id="app-sidebar"
          className={`fixed top-14 bottom-0 left-0 z-20 w-64 overflow-y-auto border-r border-line bg-white transition-transform lg:sticky lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          } ${menuOpen ? "" : "max-lg:invisible"}`}
        >
          <Sidebar user={user} onNavigate={() => setMenuOpen(false)} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
