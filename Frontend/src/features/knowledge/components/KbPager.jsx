import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui";

/** "N articles" and, with more than one page, Previous / "Page x of y" / Next. */
export default function KbPager({ total, page, pageSize, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted" data-testid="kb-total">
        {total} {total === 1 ? "article" : "articles"}
      </span>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="min-h-11 min-w-11"
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPage(page + 1)}
            disabled={page >= pages}
            aria-label="Next page"
            className="min-h-11 min-w-11"
          >
            <ChevronRight aria-hidden="true" size={16} />
          </Button>
        </nav>
      )}
    </div>
  );
}
