import { Lock } from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import { Chip, RichTextView } from "@/shared/ui";
import { COMMENT_KIND } from "../api/endpoints.js";
import { personName, workflowBody, workflowLabel } from "../ticketText.js";
import AttachmentList from "./AttachmentList.jsx";

/** A workflow entry (kind 1): one compact grey timeline line with the note under it. */
function WorkflowLine({ comment }) {
  return (
    <li
      data-testid={`comment-${comment.id}`}
      data-kind="workflow"
      className="relative border-l-2 border-line py-1 pl-4 text-xs text-muted"
    >
      <span
        aria-hidden="true"
        className="absolute top-2.5 -left-[5px] h-2 w-2 rounded-full bg-line"
      />
      <p>
        <span className="font-semibold text-body">
          {workflowLabel(comment) ?? "Update"}
        </span>
        {" · "}
        {personName(comment.author)}
        {comment.isInternal && " · internal"}
        {" · "}
        {formatWat(comment.createdAt)}
      </p>
      <RichTextView
        html={workflowBody(comment)}
        className="mt-0.5 text-xs! text-muted!"
      />
    </li>
  );
}

/** Comments oldest first. Internal notes (staff only) on light orange with an "Internal" chip. */
export default function Conversation({ ticketId, comments }) {
  if (!comments.length) {
    return <p className="text-sm text-muted">No replies yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {comments.map((comment) => {
        if (comment.kind === COMMENT_KIND.Workflow) {
          return <WorkflowLine key={comment.id} comment={comment} />;
        }
        return (
          <li
            key={comment.id}
            data-testid={`comment-${comment.id}`}
            data-internal={comment.isInternal || undefined}
            className={`rounded-card border p-4 ${comment.isInternal ? "border-brand-orange/50 bg-brand-orange-light" : "border-line bg-white"}`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-ink">
                {personName(comment.author)}
              </span>
              {comment.isInternal && (
                <Chip tone="orange">
                  <Lock aria-hidden="true" size={11} />
                  Internal
                </Chip>
              )}
              <span className="text-xs text-muted">
                {formatWat(comment.createdAt)}
              </span>
            </div>
            <RichTextView html={comment.bodyHtml} />
            {comment.attachments.length > 0 && (
              <div className="mt-3">
                <AttachmentList
                  ticketId={ticketId}
                  files={comment.attachments}
                  label={`Files of the ${comment.isInternal ? "internal note" : "reply"} by ${personName(comment.author)}`}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
