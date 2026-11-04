import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { formatWat } from "@/shared/lib/time";
import { Button, Chip, Spinner } from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import { personName } from "../ticketText.js";
import StatusChip from "./StatusChip.jsx";

const th = "px-4 py-2.5 whitespace-nowrap";
const td = "px-4 py-3";

/**
 * A list of tickets; a row opens the ticket. `queue` adds Unit, Requester and Assignee (work queue);
 * a New ticket's assignee shows an orange "Waiting" chip (no one available yet).
 * The pager shows when `pages` > 1.
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
}) {
  const navigate = useNavigate();

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
          <thead className="bg-page text-xs font-semibold text-muted uppercase">
            <tr>
              <th scope="col" className={th}>
                Reference
              </th>
              <th scope="col" className={th}>
                Subject
              </th>
              <th scope="col" className={th}>
                Category
              </th>
              {queue && (
                <th scope="col" className={th}>
                  Unit
                </th>
              )}
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
              <th scope="col" className={th}>
                Location
              </th>
              <th scope="col" className={th}>
                Raised (WAT)
              </th>
              <th scope="col" className={th}>
                Updated
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
                className="cursor-pointer hover:bg-page"
              >
                <td className={`${td} whitespace-nowrap`}>
                  <Link
                    to={`/tickets/${ticket.reference}`}
                    onClick={(event) => event.stopPropagation()}
                    className="font-semibold text-brand-navy hover:underline"
                  >
                    {ticket.reference}
                  </Link>
                </td>
                <td className={`${td} max-w-72 min-w-48`}>
                  <span className="line-clamp-2 text-ink">
                    {ticket.subject}
                  </span>
                </td>
                <td className={td}>{ticket.categoryName}</td>
                {queue && <td className={td}>{ticket.unitName}</td>}
                <td className={td}>
                  <StatusChip status={ticket.status} />
                </td>
                <td className={td}>
                  <PriorityChip priority={ticket.priority} />
                </td>
                {queue && (
                  <>
                    <td className={td}>{personName(ticket.requester)}</td>
                    <td className={td}>
                      {ticket.status === STATUS.New ? (
                        <Chip tone="orange">Waiting</Chip>
                      ) : ticket.assignee ? (
                        personName(ticket.assignee)
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </td>
                  </>
                )}
                <td className={td}>{ticket.locationName}</td>
                <td className={`${td} whitespace-nowrap text-body`}>
                  {formatWat(ticket.createdAt)}
                </td>
                <td className={`${td} whitespace-nowrap text-body`}>
                  {ticket.updatedAt ? formatWat(ticket.updatedAt) : "—"}
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
