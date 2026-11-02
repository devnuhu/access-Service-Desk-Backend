import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useSignOut } from "@/features/auth";
import { RoleChips } from "@/shared/ui";

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
        className="flex items-center gap-2 rounded-[6px] py-1 pr-2 pl-1 text-white hover:bg-white/10"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-navy"
        >
          {initials(name)}
        </span>
        <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
          {name}
        </span>
        <span className="sr-only sm:hidden">Account menu for {name}</span>
        <ChevronDown aria-hidden="true" size={16} />
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
            <button
              ref={signOutRef}
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-sm font-medium text-ink hover:bg-page"
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
