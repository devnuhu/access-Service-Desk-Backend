import { useRef, useState } from "react";
import { Braces } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { isRichTextEmpty } from "@/shared/lib/richText";
import {
  Button,
  ConfirmDialog,
  Dialog,
  RichTextEditor,
  Spinner,
  useToast,
} from "@/shared/ui";
import {
  useCategoryTemplate,
  useSaveCategoryTemplate,
} from "../hooks/useCategoryTemplate.js";

const SUBJECT_MAX = 150;

/** The words a template may use; anything else is refused by the server (400 naming the word). */
const TEMPLATE_PLACEHOLDERS = [
  ["{{requester.name}}", "The person the ticket is for"],
  ["{{ticket.category}}", "The category chosen"],
  ["{{unit.name}}", "The unit that handles it"],
  ["{{department.name}}", "The department"],
  ["{{today}}", "Today's date"],
];

function TemplateForm({ category, template, onClose }) {
  const toast = useToast();
  const save = useSaveCategoryTemplate(category.id);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [descriptionHtml, setDescriptionHtml] = useState(
    template.descriptionHtml ?? "",
  );
  const [errors, setErrors] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const subjectRef = useRef(null);
  const editorRef = useRef(null);
  // Which field a placeholder goes into: the last one used.
  const [target, setTarget] = useState("description");
  const hasTemplate = Boolean(template.subject || template.descriptionHtml);

  const send = async (body, removing = false) => {
    try {
      await save.mutateAsync(body);
      toast.success(
        removing
          ? "Requesters no longer get a suggested text."
          : "Requesters see it when they choose the category.",
        { title: removing ? "Template removed" : "Template saved" },
      );
      onClose();
    } catch (error) {
      const found = {
        subject: fieldError(error, "subject"),
        descriptionHtml: fieldError(error, "descriptionHtml"),
      };
      setErrors({
        ...found,
        form:
          found.subject || found.descriptionHtml ? undefined : error.message,
      });
      setConfirmRemove(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const text = subject.trim();
    if (text.length > SUBJECT_MAX) {
      setErrors({ subject: `Use at most ${SUBJECT_MAX} characters.` });
      return;
    }
    const empty = !text && isRichTextEmpty(descriptionHtml);
    send(
      {
        subject: text || null,
        descriptionHtml: isRichTextEmpty(descriptionHtml)
          ? null
          : descriptionHtml,
      },
      empty,
    );
  };

  const insert = (token) => {
    if (target === "subject") {
      const input = subjectRef.current;
      const start = input?.selectionStart ?? subject.length;
      const end = input?.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      setErrors((e) => ({ ...e, subject: undefined }));
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      editorRef.current?.insert(token);
    }
  };

  return (
    <>
      <form
        id="template-form"
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
              htmlFor="template-subject"
              className="block text-sm font-semibold text-ink"
            >
              Subject
            </label>
            <input
              ref={subjectRef}
              id="template-subject"
              value={subject}
              onFocus={() => setTarget("subject")}
              onChange={(event) => {
                setSubject(event.target.value);
                setErrors((e) => ({
                  ...e,
                  subject: undefined,
                  form: undefined,
                }));
              }}
              aria-invalid={errors.subject ? "true" : undefined}
              aria-describedby={
                errors.subject ? "template-subject-error" : undefined
              }
              className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${errors.subject ? "border-danger" : "border-line"}`}
            />
            {errors.subject && (
              <p
                id="template-subject-error"
                className="mt-1 text-xs font-medium text-danger"
              >
                {errors.subject}
              </p>
            )}
          </div>
          <div onFocus={() => setTarget("description")}>
            <p
              id="template-description-label"
              className="mb-1 text-sm font-semibold text-ink"
            >
              Description
            </p>
            <RichTextEditor
              id="template-description"
              compact
              value={descriptionHtml}
              onChange={(html) => {
                setDescriptionHtml(html);
                if (errors.descriptionHtml || errors.form)
                  setErrors((e) => ({
                    ...e,
                    descriptionHtml: undefined,
                    form: undefined,
                  }));
              }}
              labelledBy="template-description-label"
              describedBy={
                errors.descriptionHtml
                  ? "template-description-error"
                  : undefined
              }
              invalid={Boolean(errors.descriptionHtml)}
              toolbarLabel="Template formatting"
              apiRef={editorRef}
            />
            {errors.descriptionHtml && (
              <p
                id="template-description-error"
                className="mt-1 text-xs font-medium text-danger"
              >
                {errors.descriptionHtml}
              </p>
            )}
          </div>
        </div>

        <aside
          aria-labelledby="template-placeholders"
          className="rounded-lg border border-line bg-page/60 p-3"
        >
          <h3
            id="template-placeholders"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <Braces aria-hidden="true" size={15} className="text-brand-navy" />
            Placeholders
          </h3>
          <p className="mt-1 text-xs text-muted">
            Click one to insert it where you were typing.
          </p>
          <ul className="mt-2 space-y-1">
            {TEMPLATE_PLACEHOLDERS.map(([token, text]) => (
              <li key={token}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(token)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white"
                >
                  <code className="text-xs font-semibold text-brand-navy">
                    {token}
                  </code>
                  <span className="block text-xs text-muted">{text}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </form>

      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        {hasTemplate ? (
          <Button
            variant="danger"
            onClick={() => setConfirmRemove(true)}
            disabled={save.isPending}
          >
            Remove template
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="template-form" busy={save.isPending}>
            Save template
          </Button>
        </span>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove the template of ${category.name}?`}
        message="Requesters will start from empty fields. Tickets already raised keep their text."
        confirmLabel="Remove template"
        danger
        busy={save.isPending}
        onConfirm={() => send({ subject: null, descriptionHtml: null }, true)}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}

/**
 * The template of one category: a suggested subject and description requesters start from when
 * they choose it. For the Super Admin, the head of the category's unit and the Department Admin
 * (the server decides: a 403 shows its message). Placeholders are filled in for each requester.
 * `category`: { id, name }.
 */
export default function TemplateEditorDialog({ category, onClose }) {
  const template = useCategoryTemplate(category.id);
  return (
    <Dialog
      open
      size="wide"
      onClose={onClose}
      title={`Template: ${category.name}`}
      description="What requesters start from when they choose this category. They can change all of it."
    >
      {template.isLoading ? (
        <div className="py-10 text-center text-muted">
          <Spinner label="Loading the template…" />
        </div>
      ) : template.isError ? (
        <p role="alert" className="py-6 text-sm text-danger">
          {template.error.message}
        </p>
      ) : (
        <TemplateForm
          category={category}
          template={template.data}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}
