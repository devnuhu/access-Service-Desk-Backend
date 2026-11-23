import { Hourglass } from "lucide-react";
import { watDaysSince } from "@/shared/lib/time";
import { STATUS } from "../api/endpoints.js";
import { daysText, waitChipText, waitTone } from "../pendingWait.js";

const TONE = {
  neutral: "bg-page text-body ring-line",
  amber: "bg-brand-orange-light text-brand-orange-ink ring-brand-orange/40",
  red: "bg-danger-light text-danger ring-danger/30",
};

/**
 * A Pending ticket's wait: "Waiting on requester · 5d", neutral up to 4 days, amber from 5, red
 * from 10 (../pendingWait.js). Nothing for any other status or without a pendingSince. It wraps
 * on a narrow screen. `you`: the requester's own list ("Waiting on you · 5d").
 */
export default function PendingWaitChip({ ticket, now, you = false }) {
  if (ticket.status !== STATUS.Pending) return null;
  const days = watDaysSince(ticket.pendingSince, now);
  if (days == null) return null;
  const tone = waitTone(days);
  return (
    <span
      data-testid="pending-wait"
      data-tone={tone}
      title={`Pending for ${daysText(days)}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}
    >
      <Hourglass aria-hidden="true" size={12} className="shrink-0" />
      <span className="min-w-0 break-words">
        {waitChipText(ticket.pendingReason, days, { you })}
      </span>
    </span>
  );
}
