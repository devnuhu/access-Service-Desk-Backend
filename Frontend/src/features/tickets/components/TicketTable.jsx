import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { formatWat } from "@/shared/lib/time";
import { Button, Chip, Spinner } from "@/shared/ui";
import { SLA_LEVEL, STATUS } from "../api/endpoints.js";
import { personName } from "../ticketText.js";
import Ago from "./Ago.jsx";
import DueTime from "./DueTime.jsx";
import EscalatedBadge from "./EscalatedBadge.jsx";
import PendingWaitChip from "./PendingWaitChip.jsx";
import RowMarkers from "./RowMarkers.jsx";
import SlaBadge from "./SlaBadge.jsx";
import StatusChip from "./StatusChip.jsx";

/** The first answer to the requester; "Waiting" while an assigned ticket has none. */
function FirstResponse({ ticket }) {
  if (ticket.firstRespondedAt) return formatWat(ticket.firstRespondedAt);
  if (ticket.assignee)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-orange-ink">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-brand-orange"
        />
        Waiting
      </span>
    );
  return <span className="text-muted">—</span>;
}

const th = "px-4 py-3 whitespace-nowrap";
const td = "px-4 py-3.5 align-top";

/** "17 Nov 2026" over "02:47 WAT": two short lines instead of one long one. */
function When({ at }) {
  const full = formatWat(at);
  const [date, time] = full.replace(/^w{3} /, "").split(", ");
  return (
    <time dateTime={at} title={full} className="block whitespace-nowrap">
      <span className="block text-ink">{date}</span>
      <span className="block text-xs text-muted">{time}</span>
    </time>
  );
}

/**
 * A list of tickets; a row opens the ticket. `queue` adds Unit, Requester and Assignee (work queue);
 * a New ticket's assignee shows an orange "Waiting" chip (no one available yet).
 * The pager shows when `pages` > 1. An unread row (someone else wrote since I last opened it) is
 * bold with a dot; markers show comments, files and, in the queue, "Requester replied".
 * `selected` (a Set of ids) with `onSelect(ticket, on)` and `onSelectAll(on)` adds checkboxes.
 */
export default function TicketTable({
  items,
  isLoading,
  error,
  dimmed = false,
  queue = false,
  empty,
  total,
  page,
  pages,
  onPage,
  selected,
  onSelect,
  onSelectAll,
}) {
  const navigate = useNavigate();
  const selectable = Boolean(selected);

  if (isLoading) {
    return (
      <div className="px-5 py-10 text-center text-muted">
        <Spinner label="Loading tickets…" />
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="px-5 py-10 text-center text-sm text-danger">
        {error.message}
      </p>
    );
  }
  if (!items.length) return empty;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-page/60 text-[11px] font-semibold tracking-wider text-muted uppercase">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select every ticket on this page"
                    checked={items.every((t) => selected.has(t.id))}
                    onChange={(event) => onSelectAll(event.target.checked)}
                    className="h-4 w-4 accent-brand-navy"
                  />
                </th>
              )}
              <th scope="col" className={th}>
                Ticket
              </th>
              <th scope="col" className={th}>
                {queue ? "Category and unit" : "Category"}
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                Priority
              </th>
              {queue && (
                <>
                  <th scope="col" className={th}>
                    Requester
                  </th>
                  <th scope="col" className={th}>
                    Assignee
                  </th>
                </>
              )}
              {!queue && (
                <th scope="col" className={th}>
                  Location
                </th>
              )}
              <th scope="col" className={th}>
                {queue ? "Created" : "Raised"}
              </th>
              <th scope="col" className={th}>
                {queue ? "First response" : "Updated"}
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-line ${dimmed ? "opacity-60" : ""}`}
          >
            {items.map((ticket) => (
              <tr
                key={ticket.id}
                data-testid={`ticket-row-${ticket.reference}`}
                onClick={() => navigate(`/tickets/${ticket.reference}`)}
                data-unread={ticket.unread ? "true" : undefined}
                className={`cursor-pointer transition-colors hover:bg-brand-navy-light/40 ${selectable && selected.has(ticket.id) ? "bg-brand-navy-light/50" : ""}`}
              >
                {selectable && (
                  <td
                    className={`${td} w-10`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${ticket.reference}`}
                      checked={selected.has(ticket.id)}
                      onChange={(event) =>
                        onSelect(ticket, event.target.checked)
                      }
                      className="h-4 w-4 accent-brand-navy"
                    />
                  </td>
                )}
                <td className={`${td} max-w-80 min-w-56`}>
                  <span className="flex items-center gap-1.5">
                    {ticket.unread && (
                      <span
                        data-testid="unread-dot"
                        title="Something new since you last opened it"
                        className="h-2 w-2 shrink-0 rounded-full bg-brand-orange"
                      >
                        <span className="sr-only">Unread. </span>
                      </span>
                    )}
                    <Link
                      to={`/tickets/${ticket.reference}`}
                      onClick={(event) => event.stopPropagation()}
                      className="text-xs font-semibold tracking-wide text-brand-navy hover:underline"
                    >
                      {ticket.reference}
                    </Link>
                  </span>
                  <span
                    className={`mt-0.5 line-clamp-2 text-ink ${ticket.unread ? "font-bold" : "font-medium"}`}
                  >
                    {ticket.subject}
                  </span>
                  <RowMarkers ticket={ticket} staff={queue} />
                </td>
                <td className={`${td} min-w-40`}>
                  <span className="block text-ink">{ticket.categoryName}</span>
                  {queue && (
                    <span className="block text-xs text-muted">
                      {ticket.unitName}
                    </span>
                  )}
                </td>
                <td className={`${td} min-w-44`}>
                  <StatusChip status={ticket.status} />
                  {ticket.status === STATUS.Pending && (
                    <span className="mt-1.5 flex">
                      <PendingWaitChip ticket={ticket} />
                    </span>
                  )}
                  {(ticket.escalatedToHeadAt ||
                    ticket.slaDueAt ||
                    ticket.slaLevel > SLA_LEVEL.OnTrack) && (
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <SlaBadge level={ticket.slaLevel} />
                      <DueTime at={ticket.slaDueAt} />
                      {ticket.escalatedToHeadAt && (
                        <EscalatedBadge at={ticket.escalatedToHeadAt} short />
                      )}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <PriorityChip priority={ticket.priority} />
                </td>
                {queue && (
                  <>
                    <td className={`${td} text-ink`}>
                      {personName(ticket.requester)}
                    </td>
                    <td className={td}>
                      {ticket.status === STATUS.New ? (
                        <Chip tone="orange">Waiting</Chip>
                      ) : ticket.assignee ? (
                        <>
                          <span className="text-ink">
                            {personName(ticket.assignee)}
                          </span>
                          {ticket.assignedAt && (
                            <span className="block text-xs whitespace-nowrap text-muted">
                              Assigned <Ago at={ticket.assignedAt} />
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </td>
                  </>
                )}
                {!queue && <td className={td}>{ticket.locationName}</td>}
                <td className={td}>
                  <When at={ticket.createdAt} />
                </td>
                <td
                  className={`${td} text-xs whitespace-nowrap text-body`}
                  data-testid={queue ? "first-response" : undefined}
                >
                  {queue ? (
                    <FirstResponse ticket={ticket} />
                  ) : ticket.updatedAt ? (
                    formatWat(ticket.updatedAt)
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
        <span className="text-muted">
          {total} {total === 1 ? "ticket" : "tickets"}
        </span>
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
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
            >
              <ChevronRight aria-hidden="true" size={16} />
            </Button>
          </nav>
        )}
      </div>
    </>
  );
}
