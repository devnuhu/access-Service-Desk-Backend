import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, newest last. Only the top one handles Escape and Tab (a confirm over a side panel).
const openStack = [];

/**
 * Modal dialog: focus moves inside on open and returns on close, Tab stays inside, Escape closes.
 * side="right" shows it as a side panel.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  side,
  children,
  footer,
  initialFocusRef,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const panel = panelRef.current;
    const first =
      initialFocusRef?.current ?? panel?.querySelector(FOCUSABLE) ?? panel;
    first?.focus();

    const marker = {};
    openStack.push(marker);

    const onKeyDown = (event) => {
      if (openStack[openStack.length - 1] !== marker) return;
      if (event.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      openStack.splice(openStack.indexOf(marker), 1);
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const panelClass =
    side === "right"
      ? "ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-xl"
      : "m-auto flex max-h-[90vh] w-full max-w-lg flex-col rounded-card bg-white shadow-xl";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-ink/40 p-0 sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`${panelClass} ${side === "right" ? "sm:-my-4 sm:-mr-4" : ""}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-page hover:text-ink"
            aria-label="Close"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
