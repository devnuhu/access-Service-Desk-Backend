import { useState } from "react";
import { Lock, MessageSquare } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { isRichTextEmpty, RICH_TEXT_MAX } from "@/shared/lib/richText";
import { Button, FilePicker, RichTextEditor, useToast } from "@/shared/ui";
import { useAddComment } from "../hooks/useTickets.js";

/**
 * Reply to a ticket: formatted text and files. Staff who may add internal notes choose "Public
 * reply" or "Internal note" (internal by default for them); the choice and the button turn orange
 * for an internal note.
 */
export default function ReplyBox({ ticket }) {
  const toast = useToast();
  const addComment = useAddComment(ticket.id);
  const staff = ticket.canAddInternalNote;
  const [bodyHtml, setBodyHtml] = useState("");
  const [files, setFiles] = useState([]);
  const [isInternal, setIsInternal] = useState(staff);
  const [errors, setErrors] = useState({});
  const internal = staff && isInternal;

  const submit = async (event) => {
    event.preventDefault();
    const found = {};
    if (isRichTextEmpty(bodyHtml)) found.bodyHtml = "Write a comment.";
    else if (bodyHtml.length > RICH_TEXT_MAX)
      found.bodyHtml = "The text is too long. Attach large tables as files.";
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById("reply-body")?.focus();
      return;
    }
    try {
      await addComment.mutateAsync({ bodyHtml, isInternal: internal, files });
      setBodyHtml("");
      setFiles([]);
      setErrors({});
      toast.success(internal ? "Internal note added." : "Reply sent.");
    } catch (error) {
      const server = {
        bodyHtml: fieldError(error, "bodyHtml"),
        files: fieldError(error, "files"),
      };
      setErrors(server);
      if (!server.bodyHtml && !server.files) toast.error(error.message);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Reply"
      className={`space-y-3 rounded-card border p-4 ${internal ? "border-brand-orange bg-brand-orange-light/40" : "border-line bg-white"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reply-label" className="text-base font-semibold">
          {internal ? "Internal note" : "Reply"}
        </h2>
        {staff && (
          <div
            role="radiogroup"
            aria-label="Who sees it"
            className="inline-flex rounded-[6px] border border-line bg-white p-0.5"
          >
            {[
              [false, "Public reply", MessageSquare],
              [true, "Internal note", Lock],
            ].map(([value, label, Icon]) => {
              const checked = isInternal === value;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setIsInternal(value)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold ${
                    checked
                      ? value
                        ? "bg-brand-orange text-white"
                        : "bg-brand-navy text-white"
                      : "text-body hover:bg-page"
                  }`}
                >
                  <Icon aria-hidden="true" size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {internal && (
        <p className="text-xs text-brand-orange-ink">
          Only the department&apos;s staff and Super Admins see internal notes
          and their files.
        </p>
      )}
      <RichTextEditor
        id="reply-body"
        compact
        value={bodyHtml}
        onChange={(html) => {
          setBodyHtml(html);
          if (errors.bodyHtml)
            setErrors((e) => ({ ...e, bodyHtml: undefined }));
        }}
        labelledBy="reply-label"
        describedBy={errors.bodyHtml ? "reply-body-error" : undefined}
        invalid={Boolean(errors.bodyHtml)}
        toolbarLabel="Reply formatting"
      />
      {errors.bodyHtml && (
        <p id="reply-body-error" className="text-xs font-medium text-danger">
          {errors.bodyHtml}
        </p>
      )}
      <FilePicker
        id="reply-files"
        files={files}
        onChange={(next) => {
          setFiles(next);
          if (errors.files) setErrors((e) => ({ ...e, files: undefined }));
        }}
        error={errors.files}
        disabled={addComment.isPending}
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          busy={addComment.isPending}
          busyText="Sending…"
          variant={internal ? "internal" : "primary"}
        >
          {internal ? "Add internal note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
