import { Link, useParams } from "react-router-dom";
import { ChevronRight, SearchX } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { formatWat } from "@/shared/lib/time";
import { Card, MessageCard, RichTextView, Spinner } from "@/shared/ui";
import AttachmentList from "../components/AttachmentList.jsx";
import Conversation from "../components/Conversation.jsx";
import ReplyBox from "../components/ReplyBox.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { useTicket } from "../hooks/useTickets.js";
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
  const query = useTicket({ reference, id });

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

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
          <li>
            <Link
              to="/tickets"
              className="font-semibold text-brand-navy hover:underline"
            >
              My requests
            </Link>
          </li>
          <ChevronRight aria-hidden="true" size={14} />
          <li aria-current="page" className="text-ink">
            {ticket.reference}
          </li>
        </ol>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-brand-navy">
            {ticket.reference}
          </span>
          <StatusChip status={ticket.status} />
          <PriorityChip priority={ticket.priority} />
        </div>
        <h1 className="text-2xl font-semibold break-words">{ticket.subject}</h1>
        <p className="text-sm text-body">
          {ticket.categoryName} · {ticket.unitName} · {ticket.departmentName}
          <span className="text-muted"> · </span>
          {ticket.locationName}
        </p>
        <p className="text-sm text-body">
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
      </header>

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
              This ticket is closed.
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
                      <li key={person.userId}>{personName(person)}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">No one</span>
                )}
              </Detail>
              <Detail label="Raised">{formatWat(ticket.createdAt)}</Detail>
              <Detail label="Updated">
                {ticket.updatedAt ? formatWat(ticket.updatedAt) : "—"}
              </Detail>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold">Actions</h2>
            <p className="mt-1 text-sm text-muted">
              Assignment, acknowledgement and resolution arrive in the next
              release.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
