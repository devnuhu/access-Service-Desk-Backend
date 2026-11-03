import { useCallback, useMemo, useRef, useState } from "react";
import {
  BellRing,
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";
import { ToastContext } from "./toastContext.js";

const STYLE = {
  success: {
    icon: CircleCheck,
    edge: "border-l-brand-green",
    color: "text-brand-green-ink",
  },
  error: { icon: CircleAlert, edge: "border-l-danger", color: "text-danger" },
  info: { icon: Info, edge: "border-l-brand-navy", color: "text-brand-navy" },
  warning: {
    icon: TriangleAlert,
    edge: "border-l-brand-orange",
    color: "text-brand-orange-ink",
  },
  action: {
    icon: BellRing,
    edge: "border-l-brand-orange",
    color: "text-brand-orange-ink",
  },
};

const DURATION = 6000;

/**
 * Toasts in one aria-live region, bottom right. Errors stay a little longer. An optional
 * action ({ label, onClick }) shows a button under the message.
 */
export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone, message, { title, action } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [
        ...list.slice(-3),
        { id, tone, message, title, action },
      ]);
      window.setTimeout(
        () => dismiss(id),
        tone === "error" ? DURATION * 1.5 : DURATION,
      );
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (message, options) => show("success", message, options),
      error: (message, options) => show("error", message, options),
      info: (message, options) => show("info", message, options),
      warning: (message, options) => show("warning", message, options),
      action: (message, options) => show("action", message, options),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map(({ id, tone, message, title, action }) => {
          const { icon: Icon, edge, color } = STYLE[tone];
          return (
            <div
              key={id}
              data-tone={tone}
              className={`pointer-events-auto flex items-start gap-3 rounded-card border border-l-4 border-line bg-white px-4 py-3 shadow-lg ${edge}`}
            >
              <Icon
                aria-hidden="true"
                size={18}
                className={`mt-0.5 shrink-0 ${color}`}
              />
              <div className="min-w-0 flex-1 text-sm">
                {title && <p className="font-semibold text-ink">{title}</p>}
                <p className="text-body">{message}</p>
                {action && (
                  <button
                    type="button"
                    onClick={() => {
                      dismiss(id);
                      action.onClick();
                    }}
                    className="mt-1 text-sm font-semibold text-brand-navy hover:underline"
                  >
                    {action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(id)}
                className="rounded p-0.5 text-muted hover:text-ink"
                aria-label="Dismiss"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
