import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import { Spinner, useToast } from "@/shared/ui";
import { NOTIFICATION_TYPE } from "../api/endpoints.js";
import {
  useLatestNotifications,
  useMarkAllRead,
  useMarkRead,
  useUnreadCount,
} from "../hooks/useNotifications.js";
import useLiveNotifications from "../hooks/useLiveNotifications.js";

const TYPE_STYLE = {
  [NOTIFICATION_TYPE.Info]: { bar: "bg-brand-navy", label: "Info" },
  [NOTIFICATION_TYPE.Success]: { bar: "bg-brand-green", label: "Success" },
  [NOTIFICATION_TYPE.Warning]: { bar: "bg-brand-orange/50", label: "Warning" },
  [NOTIFICATION_TYPE.ActionRequired]: {
    bar: "bg-brand-orange",
    label: "Action required",
  },
};

/** Only in-app paths are followed ("/x", not "//host" or a full URL). */
function localPath(url) {
  return typeof url === "string" &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.startsWith("/\\")
    ? url
    : null;
}

function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}

export default function NotificationBell() {
  useLiveNotifications();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();
  const toast = useToast();

  const { data: count = 0 } = useUnreadCount();
  const latest = useLatestNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  useEffect(() => {
    if (!open) return undefined;
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

  const openItem = async (item) => {
    try {
      if (!item.isRead) await markRead.mutateAsync(item.id);
    } catch (error) {
      toast.error(error.message);
    }
    const path = localPath(item.deepLinkUrl);
    if (path) {
      setOpen(false);
      navigate(path);
    }
  };

  const items = latest.data?.items ?? [];

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        className="relative rounded-full p-2.5 text-ink hover:bg-page"
      >
        <Bell aria-hidden="true" size={20} />
        {count > 0 && (
          <span
            data-testid="bell-count"
            className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full border-2 border-white bg-brand-orange px-1 text-center text-[10px] leading-4 font-bold text-ink"
          >
            {badgeText(count)}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-card border border-line bg-white text-body shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <button
              type="button"
              onClick={() =>
                markAll.mutate(undefined, {
                  onError: (error) => toast.error(error.message),
                })
              }
              disabled={!count || markAll.isPending}
              className="text-xs font-semibold text-brand-navy hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>

          {latest.isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-muted">
              <Spinner label="Loading…" />
            </div>
          ) : latest.isError ? (
            <p className="px-4 py-6 text-center text-sm text-danger">
              {latest.error.message}
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No notifications yet.
            </p>
          ) : (
            <ul
              className="max-h-[26rem] divide-y divide-line overflow-y-auto"
              data-testid="notification-list"
            >
              {items.map((item) => {
                const style =
                  TYPE_STYLE[item.type] ?? TYPE_STYLE[NOTIFICATION_TYPE.Info];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-page ${item.isRead ? "" : "bg-brand-navy-light/40"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-1 shrink-0 self-stretch rounded-full ${style.bar}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={`text-sm text-ink ${item.isRead ? "font-medium" : "font-semibold"}`}
                          >
                            {item.title}
                          </span>
                          {!item.isRead && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-orange">
                              <span className="sr-only">Unread</span>
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-body">
                          {item.message}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted">
                          <span className="sr-only">{style.label}, </span>
                          {formatWat(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
