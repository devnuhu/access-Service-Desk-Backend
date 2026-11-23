import { Link } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  MessageSquareReply,
  CircleCheck,
} from "lucide-react";
import {
  oldestWaitingFirst,
  PENDING_REASON,
  PendingWaitChip,
  STATUS,
  useTicketList,
} from "@/features/tickets";
import { InlineRetry } from "@/shared/ui";
import { useDashboardSummary } from "../hooks/useDashboard.js";

/** My requests filtered by status (view=mine): 4 Pending, 5 Resolved. */
const PENDING = "/tickets?status=4";
const RESOLVED = "/tickets?status=5";

/** My Pending requests (the API's largest page): sorted oldest first here, the API has no such sort. */
const WAITING = {
  view: "mine",
  status: STATUS.Pending,
  page: 1,
  pageSize: 100,
};
/** How many of the oldest show on Home; the row above opens them all. */
const SHOWN = 5;

/** The requests waiting for my reply, oldest first, each with how long it has waited. */
function WaitingOnMe({ count }) {
  const list = useTicketList(WAITING, { enabled: count > 0 });
  if (list.isLoading)
    return (
      <span
        aria-hidden="true"
        data-testid="waiting-loading"
        className="mt-1.5 block h-8 animate-pulse rounded-lg bg-white/60"
      />
    );
  if (list.isError)
    return (
      <InlineRetry
        message="The requests waiting for you could not be loaded."
        onRetry={() => list.refetch()}
        testId="waiting-error"
      />
    );
  const items = oldestWaitingFirst(
    (list.data?.items ?? []).filter(
      (t) => t.pendingReason === PENDING_REASON.Requester,
    ),
  ).slice(0, SHOWN);
  if (!items.length) return null;
  return (
    <ul
      aria-label="Waiting for your reply, oldest first"
      data-testid="waiting-on-me"
      className="mt-1.5 space-y-1 pl-2"
    >
      {items.map((ticket) => (
        <li key={ticket.id}>
          <Link
            to={`/tickets/${ticket.reference}`}
            data-testid={`waiting-${ticket.reference}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-sm hover:bg-white/70"
          >
            <span className="text-xs font-semibold text-muted tabular-nums">
              {ticket.reference}
            </span>
            <span className="min-w-0 flex-1 basis-40 truncate font-medium text-ink">
              {ticket.subject}
            </span>
            <PendingWaitChip ticket={ticket} you />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Needs your attention": requests waiting for my reply (Pending) and resolved ones waiting for my
 * confirmation, each row opening My requests filtered to them. Hidden when both are 0. Under the
 * first, the oldest few waiting for me, each with how long it has waited.
 */
export default function RequesterAttention() {
  const summary = useDashboardSummary();
  if (summary.isError && !summary.data)
    return (
      <InlineRetry
        message="Your request counts could not be loaded."
        onRetry={() => summary.refetch()}
        testId="attention-error"
      />
    );
  const mine = summary.data?.mine;
  if (!mine) return null;
  const rows = [
    mine.waitingOnMe > 0 && {
      key: "waitingOnMe",
      icon: MessageSquareReply,
      to: PENDING,
      text: `${mine.waitingOnMe} ${mine.waitingOnMe === 1 ? "request is" : "requests are"} waiting for your reply`,
    },
    mine.toConfirm > 0 && {
      key: "toConfirm",
      icon: CircleCheck,
      to: RESOLVED,
      text: `${mine.toConfirm} ${mine.toConfirm === 1 ? "request was" : "requests were"} resolved and ${mine.toConfirm === 1 ? "needs" : "need"} your confirmation`,
    },
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <section
      aria-labelledby="needs-attention"
      data-testid="needs-attention"
      className="rounded-card border border-brand-orange bg-brand-orange-light px-5 py-4"
    >
      <h2
        id="needs-attention"
        className="flex items-center gap-2 text-base font-semibold text-brand-orange-ink"
      >
        <BellRing aria-hidden="true" size={18} />
        Needs your attention
      </h2>
      <ul className="mt-2 space-y-1.5">
        {rows.map(({ key, icon: Icon, to, text }) => (
          <li key={key}>
            <Link
              to={to}
              data-testid={`attention-${key}`}
              className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-white"
            >
              <Icon
                aria-hidden="true"
                size={16}
                className="shrink-0 text-brand-orange-ink"
              />
              <span className="min-w-0 flex-1">{text}</span>
              <ArrowRight
                aria-hidden="true"
                size={16}
                className="shrink-0 text-brand-navy"
              />
            </Link>
            {key === "waitingOnMe" && <WaitingOnMe count={mine.waitingOnMe} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
