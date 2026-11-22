import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, newest last. Only the top one handles Escape and Tab (a confirm over a side panel).
const openStack = [];

/**
 * Modal dialog: focus moves inside on open and returns on close, Tab stays inside, Escape closes.
 * Centred on tablets and up, a sheet from the bottom on phones. size: "sm" (a confirmation),
 * default (a form), "wide" (room for a table). side="right" shows it as a side panel.
 */
const SIZES = {
  sm: "sm:max-w-md",
  wide: "sm:max-w-6xl",
  default: "sm:max-w-2xl",
};
export default function Dialog({
  open,
  onClose,
  title,
  description,
  side,
  size,
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
    // The first field (or, in a confirmation, the first button: Cancel), never the close button.
    const first =
      initialFocusRef?.current ??
      panel?.querySelector(`[data-dialog-body] :is(${FOCUSABLE})`) ??
      panel?.querySelector(`[data-dialog-footer] :is(${FOCUSABLE})`) ??
      panel?.querySelector(FOCUSABLE) ??
      panel;
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
      ? "dialog-side ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl ring-1 ring-ink/5"
      : `dialog-in mt-auto flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-ink/5 sm:m-auto sm:max-h-[88vh] sm:rounded-2xl ${SIZES[size] ?? SIZES.default}`;

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex bg-ink/45 p-0 backdrop-blur-[2px] sm:p-6"
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
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg leading-snug font-semibold tracking-tight text-ink"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-sm leading-relaxed text-muted"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-1 shrink-0 rounded-lg p-1.5 text-muted hover:bg-page hover:text-ink"
            aria-label="Close"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div
          data-dialog-body
          className="flex-1 overflow-y-auto px-5 py-5 sm:px-6"
        >
          {children}
        </div>
        {footer && (
          // Phones: the buttons full width, the main one on top. Larger screens: in a row, right.
          <div
            data-dialog-footer
            className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-line bg-page/60 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-6 [&>*]:w-full sm:[&>*]:w-auto"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
