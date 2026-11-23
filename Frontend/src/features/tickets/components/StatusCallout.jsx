import { formatWat } from "@/shared/lib/time";
import { PENDING_REASON, STATUS } from "../api/endpoints.js";
import { waitingLine } from "../pendingWait.js";
import { personName } from "../ticketText.js";
import Ago from "./Ago.jsx";
import { RequesterActions } from "./TicketActions.jsx";

const TONES = {
  [STATUS.Pending]: "border-brand-orange bg-brand-orange-light",
  [STATUS.Reopened]: "border-brand-orange bg-brand-orange-light",
  [STATUS.Resolved]: "border-brand-green bg-brand-green-light",
};

function focusReply() {
  const box = document.getElementById("reply-body");
  box?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  box?.focus({ preventScroll: true });
}

/**
 * "Waiting on you since 12 Nov (5 days)." for the requester, "the requester" or "a third party"
 * for everyone else; calendar days (WAT) from pendingSince.
 */
function PendingText({ ticket, isRequester }) {
  const forRequester =
    isRequester && ticket.pendingReason === PENDING_REASON.Requester;
  const line = waitingLine(ticket, { isRequester: forRequester });
  const text = line ? `${line.text}.` : "Waiting for a reply.";
  if (!forRequester) {
    return <p data-testid="pending-line">{text}</p>;
  }
  return (
    <p>
      <span data-testid="pending-line">{text}</span>{" "}
      <strong className="font-semibold">Reply below to continue.</strong> Your
      reply sends it back to the case worker.{" "}
      <button
        type="button"
        onClick={focusReply}
        className="font-semibold text-brand-navy underline"
      >
        Reply
      </button>
    </p>
  );
}

function Text({ ticket, actions, isRequester, isAssignee }) {
  const assignee = personName(ticket.assignee);
  switch (ticket.status) {
    case STATUS.New:
      return <p>Waiting for an available case worker.</p>;
    case STATUS.Assigned:
      return isAssignee ? (
        <p>
          Assigned to you {ticket.assignedAt && <Ago at={ticket.assignedAt} />}.
          Start work when you pick it up.
        </p>
      ) : (
        <p>
          Assigned to {assignee}{" "}
          {ticket.assignedAt && <Ago at={ticket.assignedAt} />}. Waiting for
          them to start.
        </p>
      );
    case STATUS.InProgress:
      return (
        <p>
          {assignee} started on it{" "}
          {ticket.acknowledgedAt && <Ago at={ticket.acknowledgedAt} />}.
        </p>
      );
    case STATUS.Pending:
      return <PendingText ticket={ticket} isRequester={isRequester} />;
    case STATUS.Resolved: {
      const label = actions?.resolutionCodes.find(
        (item) => item.code === ticket.resolutionCode,
      )?.label;
      return (
        <>
          <p>
            Resolved {ticket.resolvedAt && <Ago at={ticket.resolvedAt} />}
            {label ? `: ${label}` : ""}.
          </p>
          {ticket.resolutionNote && (
            <blockquote className="mt-2 border-l-2 border-brand-green pl-3 whitespace-pre-line text-body">
              {ticket.resolutionNote}
            </blockquote>
          )}
        </>
      );
    }
    case STATUS.Closed:
      return <p>Closed {formatWat(ticket.closedAt)}.</p>;
    case STATUS.Cancelled:
      return <p>Cancelled {formatWat(ticket.cancelledAt)}.</p>;
    case STATUS.Reopened:
      return (
        <p>
          Reopened ({ticket.reopenCount}{" "}
          {ticket.reopenCount === 1 ? "time" : "times"}). Back with {assignee}.
        </p>
      );
    default:
      return null;
  }
}

/** One line on what the status means for this viewer; the requester's buttons sit here. */
export default function StatusCallout({
  ticket,
  actions,
  isRequester,
  isAssignee,
}) {
  return (
    <section
      aria-label="Status"
      data-testid="status-callout"
      className={`rounded-card border px-4 py-3 text-sm text-ink ${TONES[ticket.status] ?? "border-line bg-white"}`}
    >
      <Text
        ticket={ticket}
        actions={actions}
        isRequester={isRequester}
        isAssignee={isAssignee}
      />
      {actions && (
        <RequesterActions
          ticket={ticket}
          actions={actions}
          isRequester={isRequester}
        />
      )}
    </section>
  );
}
