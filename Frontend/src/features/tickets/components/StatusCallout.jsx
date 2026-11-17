import { formatWat } from "@/shared/lib/time";
import { PENDING_REASON, STATUS } from "../api/endpoints.js";
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

function PendingText({ ticket, isRequester }) {
  const since = formatWat(ticket.pendingSince);
  if (ticket.pendingReason !== PENDING_REASON.Requester) {
    return <p>Waiting on a third party since {since}.</p>;
  }
  if (!isRequester) return <p>Waiting on the requester since {since}.</p>;
  return (
    <p>
      Waiting on you since {since}.{" "}
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
