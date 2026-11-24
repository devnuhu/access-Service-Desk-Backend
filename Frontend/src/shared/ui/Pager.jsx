import { ChevronLeft, ChevronRight } from "lucide-react";
import { LIST_PAGE_SIZE, pageCount, pageWindow } from "@/shared/lib/paging";
import Button from "./Button.jsx";

/**
 * The one pager for every list: "Showing 11-20 of 134" from the server's total, then (with more
 * than one page) Previous, the page numbers ("Page 2 of 14" on a phone) and Next. Nothing when
 * there are no rows; the list says so itself.
 */
export default function Pager({
  total,
  page,
  pageSize = LIST_PAGE_SIZE,
  onPage,
  className = "",
}) {
  if (!total) return null;
  const pages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(total, current * pageSize);
  const step = (label, to, disabled, Icon) => (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => onPage(to)}
      disabled={disabled}
      aria-label={label}
      className="min-h-11 min-w-11"
    >
      <Icon aria-hidden="true" size={16} />
    </Button>
  );

  return (
    <div
      data-testid="pager"
      className={`flex flex-wrap items-center justify-between gap-3 text-sm ${className}`}
    >
      <p data-testid="pager-summary" className="text-muted" aria-live="polite">
        Showing {first}-{last} of {total}
      </p>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1">
          {step("Previous page", current - 1, current <= 1, ChevronLeft)}
          <span className="px-2 sm:hidden">
            Page {current} of {pages}
          </span>
          <ul className="hidden items-center gap-1 sm:flex">
            {pageWindow(current, pages).map((n, i) =>
              n == null ? (
                <li
                  key={`gap-${i}`}
                  aria-hidden="true"
                  className="px-1 text-muted"
                >
                  …
                </li>
              ) : (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => onPage(n)}
                    aria-label={`Page ${n}`}
                    aria-current={n === current ? "page" : undefined}
                    className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold ${n === current ? "bg-brand-navy text-white" : "text-brand-navy hover:bg-page"}`}
                  >
                    {n}
                  </button>
                </li>
              ),
            )}
          </ul>
          {step("Next page", current + 1, current >= pages, ChevronRight)}
        </nav>
      )}
    </div>
  );
}
