import { Mail, MessageSquare, Paperclip } from "lucide-react";
import { relativeText } from "@/shared/lib/time";

/**
 * Small markers under a ticket's subject, for the signed-in person: comments and files they can
 * see (hidden at 0), and, for staff (`staff`), "Requester replied" when the last comment is the
 * requester's (the ticket waits for an answer).
 */
export default function RowMarkers({ ticket, staff = false }) {
  const last = ticket.lastCommentAt
    ? `Last comment ${relativeText(ticket.lastCommentAt)}`
    : undefined;
  const replied = staff && ticket.lastCommentByRequester;
  if (!ticket.commentCount && !ticket.attachmentCount && !replied) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {replied && (
        <span
          data-testid="requester-replied"
          title={last}
          className="inline-flex items-center gap-1 rounded-md bg-danger-light px-1.5 py-0.5 font-semibold text-danger ring-1 ring-danger/20 ring-inset"
        >
          <Mail aria-hidden="true" size={12} />
          Requester replied
        </span>
      )}
      {ticket.commentCount > 0 && (
        <span
          data-testid="comment-count"
          title={last}
          className="inline-flex items-center gap-1"
        >
          <MessageSquare aria-hidden="true" size={13} />
          {ticket.commentCount}
          <span className="sr-only">
            {ticket.commentCount === 1 ? " comment" : " comments"}
          </span>
        </span>
      )}
      {ticket.attachmentCount > 0 && (
        <span
          data-testid="attachment-count"
          className="inline-flex items-center gap-1"
        >
          <Paperclip aria-hidden="true" size={13} />
          {ticket.attachmentCount}
          <span className="sr-only">
            {ticket.attachmentCount === 1 ? " file" : " files"}
          </span>
        </span>
      )}
    </span>
  );
}
