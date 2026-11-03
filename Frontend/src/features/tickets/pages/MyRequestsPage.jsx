import { useState } from "react";
import { Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { Card } from "@/shared/ui";
import { STATUS_LABELS } from "../api/endpoints.js";
import RaiseTicketLink from "../components/RaiseTicketLink.jsx";
import TicketTable from "../components/TicketTable.jsx";
import { PAGE_SIZE, useTicketList } from "../hooks/useTickets.js";

const TABS = [
  ["mine", "Raised by me"],
  ["copied", "Copied to me"],
];

/** My requests: tickets I raised (or that were raised for me) and tickets I am copied on. */
export default function MyRequestsPage() {
  const [view, setView] = useState("mine");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const key = `${view}|${search}|${status}`;
  const page = pageState.key === key ? pageState.page : 1;

  const list = useTicketList({
    view,
    search,
    status: status ? Number(status) : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const total = list.data?.total ?? 0;
  const filtered = Boolean(search || status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My requests</h1>
          <p className="mt-1 text-sm text-muted">
            Tickets you raised, raised for you, or were copied on.
          </p>
        </div>
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
          <div className="relative min-w-56 flex-1">
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
              className="h-10 w-full rounded-[6px] border border-line pr-3 pl-9 text-sm text-ink"
            />
          </div>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-[6px] border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
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
          page={page}
          pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          onPage={(next) => setPageState({ page: next, key })}
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
