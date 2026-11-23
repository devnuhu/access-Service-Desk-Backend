import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { Card, InlineRetry } from "@/shared/ui";
import { useTicketList } from "../hooks/useTickets.js";
import Ago from "./Ago.jsx";
import PendingWaitChip from "./PendingWaitChip.jsx";
import StatusChip from "./StatusChip.jsx";

const LATEST = { view: "mine", open: true, page: 1, pageSize: 5 };
const ANY = { view: "mine", page: 1, pageSize: 1 };

function Skeleton() {
  return (
    <ul
      aria-hidden="true"
      data-testid="my-requests-loading"
      className="space-y-3"
    >
      {[1, 2, 3].map((i) => (
        <li key={i} className="space-y-1.5">
          <span className="block h-3.5 w-2/3 animate-pulse rounded bg-line/70" />
          <span className="block h-3 w-1/3 animate-pulse rounded bg-line/50" />
        </li>
      ))}
    </ul>
  );
}

/**
 * My latest 5 open requests (newest first): reference, subject, status, priority and when it was
 * last updated; each opens the ticket. "See all my requests" goes to My requests. With none open,
 * a person who has never raised one is told how to start.
 */
export default function MyRequestsStrip() {
  const latest = useTicketList(LATEST);
  const items = latest.data?.items ?? [];
  // Only asked when nothing is open: has this person ever raised one?
  const any = useTicketList(ANY, {
    enabled: latest.isSuccess && !items.length,
  });
  const never = any.isSuccess && any.data.total === 0;

  return (
    <Card
      as="section"
      aria-labelledby="my-requests"
      data-testid="my-requests"
      className="flex h-full flex-col px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="my-requests" className="text-base font-semibold">
          My requests
        </h2>
        <Link
          to="/tickets"
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
        >
          See all my requests
          <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
      {latest.isLoading ? (
        <Skeleton />
      ) : latest.isError ? (
        <InlineRetry
          message="Your requests could not be loaded."
          onRetry={() => latest.refetch()}
          testId="my-requests-error"
        />
      ) : items.length ? (
        <ul className="-mx-2 divide-y divide-line">
          {items.map((ticket) => (
            <li key={ticket.id}>
              <Link
                to={`/tickets/${ticket.reference}`}
                className="block rounded-lg px-2 py-2.5 hover:bg-page"
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold text-muted tabular-nums">
                    {ticket.reference}
                  </span>
                  <StatusChip status={ticket.status} />
                  <PriorityChip priority={ticket.priority} />
                  <PendingWaitChip ticket={ticket} />
                </span>
                <span className="mt-1 block truncate text-sm font-semibold text-ink">
                  {ticket.subject}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Updated <Ago at={ticket.updatedAt ?? ticket.createdAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="my-requests-empty" className="text-sm text-body">
          {never
            ? "You have not raised a request yet. Search above to get started."
            : "You have no open requests."}
        </p>
      )}
    </Card>
  );
}
