import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut } from "lucide-react";
import { useSignOut } from "@/features/auth";
import { useMyOrganisation } from "@/features/org";
import { RoleChips } from "@/shared/ui";
import { accountLinks } from "./navigation.js";

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const signOutRef = useRef(null);
  const signOut = useSignOut();
  const name = user.fullName || user.username;
  const { data: org } = useMyOrganisation();
  // Heads and HODs: My requests and My availability live here, not in the sidebar.
  const links = accountLinks(user, org);

  useEffect(() => {
    if (!open) return undefined;
    signOutRef.current?.focus();
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        className="flex items-center gap-3 rounded-full py-1 pr-2 pl-1 text-ink hover:bg-page"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-navy text-sm font-bold text-white"
        >
          {initials(name)}
        </span>
        <span className="hidden max-w-44 truncate text-[15px] font-medium sm:block">
          {name}
        </span>
        <span className="sr-only sm:hidden">Account menu for {name}</span>
        <ChevronDown aria-hidden="true" size={16} className="text-muted" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-40 mt-2 w-72 rounded-card border border-line bg-white text-body shadow-xl"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">{name}</p>
            {user.department && (
              <p className="text-xs text-muted">{user.department}</p>
            )}
            <RoleChips roles={user.roles} className="mt-2" />
          </div>
          <div className="p-1.5">
            {links.map(({ label, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-page"
              >
                <Icon aria-hidden="true" size={16} />
                {label}
              </Link>
            ))}
            <button
              ref={signOutRef}
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-page"
            >
              <LogOut aria-hidden="true" size={16} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
