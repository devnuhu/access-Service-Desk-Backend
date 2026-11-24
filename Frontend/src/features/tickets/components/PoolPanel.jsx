import { useState } from "react";
import { Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import { Pager } from "@/shared/ui";
import { usePool } from "../hooks/useTickets.js";
import PoolTable from "./PoolTable.jsx";

/**
 * The work queue's Pool tab: one page of the pool at a time (10), a search that the server runs
 * over every row, and unit chips (from the server's per-unit counts) when the person has pool
 * tickets in more than one unit of this department.
 *
 * The pool spans every unit the person works in, possibly in other departments. Only this
 * department's units are offered here; when the person also has pool tickets elsewhere, there is
 * no "All" chip and a unit is always sent (`fallbackUnitId` until one is chosen), so another
 * department's tickets never show in this queue.
 *
 * `counts` is the unfiltered GET /api/pool?pageSize=1 answer (units and total), shared with the tab
 * badge: undefined while it loads, null if it failed. Picking reloads the page; if it was the last row of the last page, the page before opens.
 */
export default function PoolPanel({
  departmentUnitIds,
  fallbackUnitId,
  counts,
  selected,
  onSelect,
  onSelectAll,
}) {
  const [text, setText] = useState("");
  const [unitId, setUnitId] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const allUnits = counts?.units ?? [];
  const here = allUnits.filter((u) => departmentUnitIds.has(u.id));
  const outside = allUnits.some((u) => !departmentUnitIds.has(u.id));
  const chosen = unitId || (outside ? (fallbackUnitId ?? "") : "");
  const paging = usePaging(`${search}|${chosen}`);
  const pool = usePool(
    {
      search,
      unitId: chosen || undefined,
      page: paging.page,
      pageSize: LIST_PAGE_SIZE,
    },
    // Wait for the counts (they decide the unit); if they failed (null), go ahead without.
    { enabled: counts !== undefined },
  );
  useLastPageClamp(paging, pool.data?.total);
  const items = pool.data?.items ?? [];
  // Counts on the chips follow the search (the server counts the matches per unit).
  const countOf = (id) =>
    pool.data?.units.find((u) => u.id === id)?.count ??
    (search ? 0 : here.find((u) => u.id === id)?.count);
  const chips = here.length > 1;
  const chip = (id, label, count) => {
    const on = chosen === id;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={on}
        onClick={() => setUnitId(id)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 ring-inset ${on ? "bg-brand-navy text-white ring-brand-navy" : "bg-white text-body ring-line hover:bg-page"}`}
      >
        {label}
        {count != null && (
          <span className={on ? "text-white/80" : "text-muted"}>{count}</span>
        )}
      </button>
    );
  };

  return (
    <div data-testid="pool-panel">
      <div className="space-y-3 px-5 pt-4">
        <p className="text-sm text-muted">
          New tickets nobody holds yet, oldest first. Pick one to make it yours.
        </p>
        <div className="relative max-w-md">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            aria-label="Search the pool"
            placeholder="Reference, subject or category"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-sm text-ink"
          />
        </div>
        {chips && (
          <div
            role="group"
            aria-label="Unit"
            data-testid="pool-units"
            className="flex flex-wrap gap-2"
          >
            {!outside && chip("", "All units", null)}
            {here.map((u) => chip(u.id, u.name, countOf(u.id)))}
          </div>
        )}
      </div>
      <PoolTable
        pool={pool}
        showUnit={chips && !chosen}
        emptyText={
          search || unitId
            ? "No tickets in the pool match."
            : "Nothing waiting in the pool. New tickets you can take show here."
        }
        selected={selected}
        onSelect={onSelect}
        onSelectAll={(on) => onSelectAll(items, on)}
      />
      {items.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <Pager
            total={pool.data.total}
            page={paging.page}
            onPage={paging.setPage}
          />
        </div>
      )}
    </div>
  );
}
