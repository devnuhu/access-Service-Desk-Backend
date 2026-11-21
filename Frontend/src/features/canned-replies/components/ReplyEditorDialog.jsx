import { useRef, useState } from "react";
import { Braces } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { isRichTextEmpty, RICH_TEXT_MAX } from "@/shared/lib/richText";
import { Button, Dialog, RichTextEditor } from "@/shared/ui";
import { usePlaceholders, useSaveReply } from "../hooks/useCannedReplies.js";

/**
 * Add a reply to a library, or change one (`reply`). The same editor as comments; beside it the
 * placeholders, each inserted at the cursor with a click. 400 puts errors.title / errors.bodyHtml
 * under their fields; 409 (title already used) goes under the title.
 */
export default function ReplyEditorDialog({ unitId, reply, onClose, onSaved }) {
  const save = useSaveReply(unitId);
  const placeholders = usePlaceholders();
  const [title, setTitle] = useState(reply?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(reply?.bodyHtml ?? "");
  const [errors, setErrors] = useState({});
  const titleRef = useRef(null);
  const editorRef = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const value = title.trim();
    const found = {};
    if (value.length < 2 || value.length > 100)
      found.title = "Use 2 to 100 characters.";
    if (isRichTextEmpty(bodyHtml)) found.bodyHtml = "Write the reply.";
    else if (bodyHtml.length > RICH_TEXT_MAX)
      found.bodyHtml = "The text is too long.";
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const saved = await save.mutateAsync({
        replyId: reply?.id,
        title: value,
        bodyHtml,
      });
      onSaved(saved, Boolean(reply));
    } catch (error) {
      const server = {
        title:
          fieldError(error, "title") ??
          (error.status === 409 ? error.message : undefined),
        bodyHtml: fieldError(error, "bodyHtml"),
      };
      setErrors({
        ...server,
        form: server.title || server.bodyHtml ? undefined : error.message,
      });
    }
  };

  return (
    <Dialog
      open
      size="wide"
      onClose={onClose}
      title={reply ? `Edit ${reply.title}` : "Add reply"}
      description="Placeholders are filled in for each ticket when the reply is used."
      initialFocusRef={titleRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reply-library-form" busy={save.isPending}>
            {reply ? "Save changes" : "Add reply"}
          </Button>
        </>
      }
    >
      <form
        id="reply-library-form"
        onSubmit={submit}
        noValidate
        className="grid gap-5 lg:grid-cols-[1fr_15rem]"
      >
        <div className="min-w-0 space-y-4">
          {errors.form && (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger"
            >
              {errors.form}
            </p>
          )}
          <div>
            <label
              htmlFor="reply-title"
              className="block text-sm font-semibold text-ink"
            >
              Title
            </label>
            <input
              ref={titleRef}
              id="reply-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setErrors((e) => ({ ...e, title: undefined, form: undefined }));
              }}
              placeholder="For example, Statement sent"
              aria-invalid={errors.title ? "true" : undefined}
              aria-describedby={errors.title ? "reply-title-error" : undefined}
              className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${errors.title ? "border-danger" : "border-line"}`}
            />
            {errors.title && (
              <p
                id="reply-title-error"
                className="mt-1 text-xs font-medium text-danger"
              >
                {errors.title}
              </p>
            )}
          </div>
          <div>
            <p
              id="reply-body-label"
              className="mb-1 text-sm font-semibold text-ink"
            >
              Reply
            </p>
            <RichTextEditor
              id="reply-library-body"
              compact
              value={bodyHtml}
              onChange={(html) => {
                setBodyHtml(html);
                if (errors.bodyHtml)
                  setErrors((e) => ({ ...e, bodyHtml: undefined }));
              }}
              labelledBy="reply-body-label"
              describedBy={
                errors.bodyHtml ? "reply-library-body-error" : undefined
              }
              invalid={Boolean(errors.bodyHtml)}
              toolbarLabel="Reply formatting"
              apiRef={editorRef}
            />
            {errors.bodyHtml && (
              <p
                id="reply-library-body-error"
                className="mt-1 text-xs font-medium text-danger"
              >
                {errors.bodyHtml}
              </p>
            )}
          </div>
        </div>

        <aside
          aria-labelledby="placeholders-title"
          className="rounded-lg border border-line bg-page/60 p-3"
        >
          <h3
            id="placeholders-title"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <Braces aria-hidden="true" size={15} className="text-brand-navy" />
            Placeholders
          </h3>
          <p className="mt-1 text-xs text-muted">Click one to insert it.</p>
          <ul className="mt-2 space-y-1">
            {(placeholders.data ?? []).map((item) => (
              <li key={item.token}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editorRef.current?.insert(item.token)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white"
                >
                  <code className="text-xs font-semibold text-brand-navy">
                    {item.token}
                  </code>
                  <span className="block text-xs text-muted">
                    {item.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </form>
    </Dialog>
  );
}
