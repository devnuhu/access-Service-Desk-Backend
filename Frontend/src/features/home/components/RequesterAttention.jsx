import { Link } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  MessageSquareReply,
  CircleCheck,
} from "lucide-react";
import { InlineRetry } from "@/shared/ui";
import { useDashboardSummary } from "../hooks/useDashboard.js";

/** My requests filtered by status (view=mine): 4 Pending, 5 Resolved. */
const PENDING = "/tickets?status=4";
const RESOLVED = "/tickets?status=5";

/**
 * "Needs your attention": requests waiting for my reply (Pending) and resolved ones waiting for my
 * confirmation, each row opening My requests filtered to them. Hidden when both are 0.
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
          </li>
        ))}
      </ul>
    </section>
  );
}
