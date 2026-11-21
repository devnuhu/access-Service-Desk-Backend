import { useParams } from "react-router-dom";
import { SearchX } from "lucide-react";
import { useSession } from "@/features/auth";
import { PriorityChip } from "@/features/catalogue";
import { formatWat } from "@/shared/lib/time";
import {
  Card,
  Chip,
  MessageCard,
  PageHeader,
  RichTextView,
  Spinner,
} from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import Ago from "../components/Ago.jsx";
import AssignmentPanel from "../components/AssignmentPanel.jsx";
import DueTime from "../components/DueTime.jsx";
import EscalatedBadge from "../components/EscalatedBadge.jsx";
import LinkedTickets, { MergedBanner } from "../components/LinkedTickets.jsx";
import SlaBadge from "../components/SlaBadge.jsx";
import AttachmentList from "../components/AttachmentList.jsx";
import PickCard from "../components/PickCard.jsx";
import Conversation from "../components/Conversation.jsx";
import ReplyBox from "../components/ReplyBox.jsx";
import StatusChip from "../components/StatusChip.jsx";
import StatusCallout from "../components/StatusCallout.jsx";
import { ActionsCard } from "../components/TicketActions.jsx";
import { useTicket, useTicketActions } from "../hooks/useTickets.js";
import { useMarkRead } from "../hooks/useQueueTools.js";
import { personName } from "../ticketText.js";

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * One ticket (/tickets/:reference or /tickets/id/:id). A 404 means it does not exist or the person
 * may not see it; the page does not say which. A pushed "Ticket" notification refetches it.
 */
export default function TicketPage() {
  const { reference, id } = useParams();
  const { user } = useSession();
  const query = useTicket({ reference, id });
  // Opening it clears its unread marker (once per ticket opened, not on refetches).
  useMarkRead(query.data?.id);
  const actions = useTicketActions(query.data?.id);

  if (query.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the ticket…" />
      </div>
    );
  }
  if (query.isError) {
    return query.error.status === 404 ? (
      <MessageCard
        icon={SearchX}
        title="Ticket not found"
        linkTo="/tickets"
        linkText="Go to My requests"
      >
        <p>Ticket not found, or you do not have access to it.</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {query.error.message}
      </p>
    );
  }

  const ticket = query.data;
  const raisedForSomeoneElse =
    ticket.raisedBy.userId !== ticket.requester.userId;
  const isRequester =
    user.id === ticket.requester.userId || user.id === ticket.raisedBy.userId;
  const isAssignee = user.id === ticket.assignee?.userId;

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          ticket.isStaffView
            ? `/departments/${ticket.departmentId}/tickets`
            : "/tickets"
        }
        title={<span className="break-words">{ticket.subject}</span>}
        crumb={ticket.reference}
        eyebrow={ticket.reference}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip status={ticket.status} />
          <PriorityChip priority={ticket.priority} />
          <SlaBadge level={ticket.slaLevel} />
          {ticket.escalatedToHeadAt && (
            <EscalatedBadge at={ticket.escalatedToHeadAt} />
          )}
        </div>
        <p className="mt-3 text-sm text-body">
          {ticket.categoryName} · {ticket.unitName} · {ticket.departmentName}
          <span className="text-muted"> · </span>
          {ticket.locationName}
        </p>
        <p className="mt-1 text-sm text-body">
          Raised {formatWat(ticket.createdAt)} by{" "}
          {raisedForSomeoneElse ? (
            <>
              {personName(ticket.raisedBy)} for{" "}
              <strong className="font-semibold text-ink">
                {personName(ticket.requester)}
              </strong>
            </>
          ) : (
            <strong className="font-semibold text-ink">
              {personName(ticket.requester)}
            </strong>
          )}
          <span className="text-muted"> · </span>
          {ticket.assignee ? (
            <>Assigned to {personName(ticket.assignee)}</>
          ) : (
            <span className="text-muted">Waiting for assignment</span>
          )}
        </p>
      </PageHeader>

      {ticket.isStaffView && <MergedBanner ticket={ticket} />}
      <StatusCallout
        ticket={ticket}
        actions={actions.data}
        isRequester={isRequester}
        isAssignee={isAssignee}
      />
      {ticket.isStaffView && ticket.escalatedToHeadReason && (
        <p
          data-testid="escalation-reason"
          className="rounded-card border border-brand-orange bg-brand-orange-light px-4 py-3 text-sm text-ink"
        >
          <strong className="font-semibold">Escalated to unit head</strong>{" "}
          <Ago at={ticket.escalatedToHeadAt} />:{" "}
          <span className="whitespace-pre-line">
            {ticket.escalatedToHeadReason}
          </span>
        </p>
      )}
      {actions.isError && (
        <p role="alert" className="text-sm text-danger">
          {actions.error.message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <h2 className="sr-only">Description</h2>
            <RichTextView html={ticket.descriptionHtml} />
            {ticket.attachments.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold">Files</h3>
                <AttachmentList
                  ticketId={ticket.id}
                  files={ticket.attachments}
                  label="Ticket files"
                />
              </div>
            )}
          </Card>

          <section aria-labelledby="conversation-heading" className="space-y-3">
            <h2 id="conversation-heading" className="text-lg font-semibold">
              Conversation
            </h2>
            <Conversation ticketId={ticket.id} comments={ticket.comments} />
          </section>

          {ticket.canComment ? (
            <ReplyBox key={ticket.id} ticket={ticket} />
          ) : (
            <p className="rounded-card border border-line bg-white px-4 py-3 text-sm text-muted">
              {ticket.status === STATUS.Cancelled
                ? "This ticket is cancelled."
                : "This ticket is closed."}
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold">Details</h2>
            <dl className="space-y-3">
              <Detail label="Requester">
                {personName(ticket.requester)}
                {ticket.requesterDepartment && (
                  <span className="block text-xs text-muted">
                    {ticket.requesterDepartment}
                  </span>
                )}
              </Detail>
              {raisedForSomeoneElse && (
                <Detail label="Raised by">{personName(ticket.raisedBy)}</Detail>
              )}
              <Detail label="Copied">
                {ticket.cc.length ? (
                  <ul>
                    {ticket.cc.map((person) => (
                      <li key={person.userId}>
                        {personName(person)}
                        {person.userId === ticket.assignee?.userId &&
                          ", copied · handling it"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">No one</span>
                )}
              </Detail>
              <Detail label="Raised">{formatWat(ticket.createdAt)}</Detail>
              <Detail label="First response">
                <span data-testid="detail-first-response">
                  {ticket.firstRespondedAt ? (
                    formatWat(ticket.firstRespondedAt)
                  ) : ticket.assignee ? (
                    <Chip tone="orange">Waiting</Chip>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
              </Detail>
              {ticket.slaDueAt && (
                <Detail label="Due">
                  <DueTime at={ticket.slaDueAt} full />
                </Detail>
              )}
              <Detail label="Updated">
                {ticket.updatedAt ? formatWat(ticket.updatedAt) : "—"}
              </Detail>
            </dl>
          </Card>
          <PickCard ticket={ticket} />
          {actions.data && (
            <ActionsCard
              ticket={ticket}
              actions={actions.data}
              isRequester={isRequester}
            />
          )}
          {ticket.isStaffView && <AssignmentPanel ticket={ticket} />}
          {ticket.isStaffView && <LinkedTickets ticket={ticket} />}
        </aside>
      </div>
    </div>
  );
}
