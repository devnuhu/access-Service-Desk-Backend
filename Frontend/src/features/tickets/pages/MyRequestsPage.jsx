import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import { Card, PageHeader } from "@/shared/ui";
import { PENDING_REASON, STATUS_LABELS } from "../api/endpoints.js";
import RaiseTicketLink from "../components/RaiseTicketLink.jsx";
import TicketTable from "../components/TicketTable.jsx";
import { PRIORITY_OPTIONS, readPriority } from "../filters.js";
import { useTicketList } from "../hooks/useTickets.js";

const OPEN = "open";
/** Pending, split by who it waits on (sent as pendingReason). */
const WAITING_ON_ME = "pending-me";
const WAITING_ON_OTHERS = "pending-other";
const PENDING_FILTERS = {
  [WAITING_ON_ME]: PENDING_REASON.Requester,
  [WAITING_ON_OTHERS]: PENDING_REASON.ThirdParty,
};

const TABS = [
  ["mine", "Raised by me"],
  ["copied", "Copied to me"],
];

/**
 * My requests: tickets I raised (or that were raised for me) and tickets I am copied on. Home's
 * tiles open it filtered with ?status=open or ?status=<number> (5: Resolved, waiting for me);
 * ?status=pending-me / pending-other are Pending tickets waiting on me / on someone else.
 * The priority filter lives in the address (?priority=3); clearing it removes it. No age filter here.
 */
export default function MyRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const priority = readPriority(searchParams.get("priority"));
  const choosePriority = (value) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("priority", value);
        else next.delete("priority");
        return next;
      },
      { replace: true },
    );
  const [view, setView] = useState("mine");
  const [text, setText] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const paging = usePaging(`${view}|${search}|${status}|${priority}`);

  const list = useTicketList({
    view,
    search,
    open: status === OPEN ? true : undefined,
    pendingReason: PENDING_FILTERS[status],
    status:
      status && status !== OPEN && !PENDING_FILTERS[status]
        ? Number(status)
        : undefined,
    priority: priority ? Number(priority) : undefined,
    page: paging.page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, list.data?.total);
  const total = list.data?.total ?? 0;
  const filtered = Boolean(search || status || priority);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="My requests"
          description="Tickets you raised, raised for you, or were copied on."
        />
        <RaiseTicketLink />
      </div>

      <Card>
        <div
          role="tablist"
          aria-label="Which tickets"
          className="flex gap-1 border-b border-line px-3 pt-2"
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${view === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-56 flex-1 self-start">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search by reference or subject"
              placeholder="Reference or subject"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-10 w-full rounded-lg border border-line pr-3 pl-9 text-sm text-ink"
            />
          </div>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="">All statuses</option>
            <option value={OPEN}>Open</option>
            <option value={WAITING_ON_ME}>Waiting on me</option>
            <option value={WAITING_ON_OTHERS}>Waiting on someone else</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Priority"
            value={priority}
            onChange={(event) => choosePriority(event.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <TicketTable
          items={list.data?.items ?? []}
          isLoading={list.isLoading}
          error={list.error}
          dimmed={list.isPlaceholderData}
          total={total}
          page={paging.page}
          onPage={paging.setPage}
          empty={
            <div className="px-5 py-10 text-center text-sm text-muted">
              {filtered ? (
                <p>No tickets match these filters.</p>
              ) : view === "copied" ? (
                <p>No one has copied you on a ticket yet.</p>
              ) : (
                <>
                  <p>You have not raised a ticket yet.</p>
                  <RaiseTicketLink className="mt-4" />
                </>
              )}
            </div>
          }
        />
      </Card>
    </div>
  );
}
