import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PenLine, SearchX } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import {
  Button,
  Card,
  MessageCard,
  PageHeader,
  RichTextEditor,
  RichTextView,
  Spinner,
  useToast,
} from "@/shared/ui";
import { KB_STATUS } from "../api/endpoints.js";
import { LIBRARY, MY_ARTICLES } from "../places.js";
import {
  useArticle,
  useKbOptions,
  usePublishArticle,
  useSaveArticle,
} from "../hooks/useKnowledge.js";

export const TITLE_MIN = 5;
export const TITLE_MAX = 200;
export const SUMMARY_MIN = 10;
export const SUMMARY_MAX = 500;
export const PUBLISHER_NOTE =
  "Save draft. A head of unit or the Head of Department publishes it.";
const FIELDS = ["title", "summary", "bodyHtml", "categoryId", "departmentId"];

const inputClass = (error) =>
  `mt-1 w-full rounded-lg border bg-white px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`;

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/** The form itself; `article` when editing (its department is fixed). */
function ArticleForm({ article, options }) {
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSaveArticle();
  const publish = usePublishArticle();
  const [departmentId, setDepartmentId] = useState(
    article?.department.id ?? (options.length === 1 ? options[0].id : ""),
  );
  const [categoryId, setCategoryId] = useState(article?.category?.id ?? "");
  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [bodyHtml, setBodyHtml] = useState(article?.bodyHtml ?? "");
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(null);
  const formRef = useRef(null);

  const department = options.find((d) => d.id === departmentId) ?? null;
  // Editing: the department's categories, keeping the article's own even if it is no longer listed.
  const categories = [...(department?.categories ?? [])];
  if (
    article?.category &&
    !categories.some((c) => c.id === article.category.id)
  )
    categories.unshift(article.category);
  const canPublish = article
    ? article.canPublish
    : Boolean(department?.canPublish);
  const published = article?.status === KB_STATUS.Published;
  const summaryLength = summary.trim().length;

  const check = () => {
    const found = {};
    if (!departmentId) found.departmentId = "Choose a department.";
    const t = title.trim().length;
    if (t < TITLE_MIN || t > TITLE_MAX)
      found.title = `Use ${TITLE_MIN} to ${TITLE_MAX} characters.`;
    if (summaryLength < SUMMARY_MIN || summaryLength > SUMMARY_MAX)
      found.summary = `Use ${SUMMARY_MIN} to ${SUMMARY_MAX} characters.`;
    const text = bodyHtml.replace(/<[^>]*>/g, "").trim();
    if (!text) found.bodyHtml = "Write the article.";
    return found;
  };

  const submit = async (andPublish) => {
    setFailure(null);
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) {
      const first = FIELDS.find((f) => found[f]);
      formRef.current
        ?.querySelector(
          `[data-field="${first}"] input, [data-field="${first}"] textarea, [data-field="${first}"] select`,
        )
        ?.focus();
      return;
    }
    setBusy(andPublish ? "publish" : "save");
    let saved = null;
    try {
      saved = await save.mutateAsync({
        id: article?.id,
        body: {
          departmentId,
          categoryId: categoryId || null,
          title: title.trim(),
          summary: summary.trim(),
          bodyHtml,
        },
      });
      if (andPublish) {
        await publish.mutateAsync({ id: saved.id, publish: true });
        toast.success("Article published.");
      } else {
        toast.success(published ? "Changes saved." : "Draft saved.");
      }
      navigate(MY_ARTICLES, { replace: true });
    } catch (error) {
      if (saved) {
        // Saved, but publishing was refused: the draft is kept.
        toast.error(error.message, { title: "Saved as a draft" });
        navigate(MY_ARTICLES, { replace: true });
        return;
      }
      const server = Object.fromEntries(
        FIELDS.map((f) => [f, fieldError(error, f)]).filter(([, m]) => m),
      );
      setErrors(server);
      if (!Object.keys(server).length) setFailure(error.message);
    } finally {
      setBusy(null);
    }
  };

  const describe = (...ids) => ids.filter(Boolean).join(" ") || undefined;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
      className="space-y-5"
      data-testid="kb-editor"
    >
      {failure && (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
        >
          {failure}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div data-field="departmentId">
          <label
            htmlFor="kb-department"
            className="block text-sm font-semibold text-ink"
          >
            Department
          </label>
          {article ? (
            <p
              id="kb-department"
              data-testid="kb-department-fixed"
              className="mt-1 flex h-10 items-center rounded-lg border border-line bg-page px-3 text-sm text-body"
            >
              {article.department.name}
            </p>
          ) : (
            <select
              id="kb-department"
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setCategoryId("");
              }}
              aria-invalid={errors.departmentId ? "true" : undefined}
              aria-describedby={describe(
                errors.departmentId && "kb-department-error",
              )}
              className={`${inputClass(errors.departmentId)} h-10`}
            >
              {options.length !== 1 && (
                <option value="">Choose a department</option>
              )}
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <FieldError id="kb-department-error" message={errors.departmentId} />
        </div>
        <div data-field="categoryId">
          <label
            htmlFor="kb-category"
            className="block text-sm font-semibold text-ink"
          >
            Category (optional)
          </label>
          <select
            id="kb-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={!departmentId}
            aria-invalid={errors.categoryId ? "true" : undefined}
            aria-describedby={describe(
              errors.categoryId && "kb-category-error",
            )}
            className={`${inputClass(errors.categoryId)} h-10 disabled:bg-page`}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <FieldError id="kb-category-error" message={errors.categoryId} />
        </div>
      </div>

      <div data-field="title">
        <label
          htmlFor="kb-title"
          className="block text-sm font-semibold text-ink"
        >
          Title
        </label>
        <input
          id="kb-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX + 20}
          autoComplete="off"
          aria-invalid={errors.title ? "true" : undefined}
          aria-describedby={describe(errors.title && "kb-title-error")}
          className={`${inputClass(errors.title)} h-10`}
        />
        <FieldError id="kb-title-error" message={errors.title} />
      </div>

      <div data-field="summary">
        <label
          htmlFor="kb-summary"
          className="block text-sm font-semibold text-ink"
        >
          Summary
        </label>
        <textarea
          id="kb-summary"
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          aria-invalid={errors.summary ? "true" : undefined}
          aria-describedby={describe(
            "kb-summary-count",
            errors.summary && "kb-summary-error",
          )}
          className={`${inputClass(errors.summary)} py-2`}
        />
        <p
          id="kb-summary-count"
          className={`text-right text-xs ${summaryLength > SUMMARY_MAX ? "font-medium text-danger" : "text-muted"}`}
        >
          {summaryLength} of {SUMMARY_MAX} characters
        </p>
        <FieldError id="kb-summary-error" message={errors.summary} />
      </div>

      <div data-field="bodyHtml">
        <p id="kb-body-label" className="text-sm font-semibold text-ink">
          Article
        </p>
        <div className="mt-1">
          <RichTextEditor
            id="kb-body"
            value={bodyHtml}
            onChange={(html) => {
              setBodyHtml(html);
              if (errors.bodyHtml)
                setErrors((e) => ({ ...e, bodyHtml: undefined }));
            }}
            labelledBy="kb-body-label"
            describedBy={describe(errors.bodyHtml && "kb-body-error")}
            invalid={Boolean(errors.bodyHtml)}
            toolbarLabel="Article formatting"
          />
        </div>
        <FieldError id="kb-body-error" message={errors.bodyHtml} />
      </div>

      {!canPublish && !published && (
        <p data-testid="kb-publisher-note" className="text-sm text-muted">
          {PUBLISHER_NOTE}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={canPublish && !published ? "secondary" : "primary"}
          busy={busy === "save"}
          disabled={Boolean(busy)}
        >
          {published ? "Save changes" : "Save draft"}
        </Button>
        {canPublish && !published && (
          <Button
            busy={busy === "publish"}
            disabled={Boolean(busy)}
            onClick={() => submit(true)}
          >
            Publish
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * New article (/knowledge/manage/new) or edit one (/knowledge/manage/:id/edit). Departments and
 * categories come from kb/options. An article I may not change is shown read only with the note.
 */
export default function ArticleEditorPage() {
  const { id } = useParams();
  const options = useKbOptions();
  const article = useArticle(id);
  const editing = Boolean(id);

  if (options.isLoading || (editing && article.isLoading)) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (editing && article.isError) {
    return article.error.status === 404 ? (
      <MessageCard
        icon={SearchX}
        title="Article not found"
        linkTo={MY_ARTICLES}
        linkText="Go to the knowledge base"
      >
        <p>This article does not exist, or you cannot change it.</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {article.error.message}
      </p>
    );
  }
  const list = options.data ?? [];
  if (!editing && list.length === 0) {
    return (
      <MessageCard
        icon={PenLine}
        title="Knowledge base"
        linkTo={LIBRARY}
        linkText="Go to the knowledge base"
      >
        <p>You do not write articles for any department.</p>
      </MessageCard>
    );
  }

  const data = article.data;
  if (editing && !data.canEdit) {
    return (
      <div className="space-y-4">
        <PageHeader
          back={`/knowledge/${data.id}`}
          title={<span className="break-words">{data.title}</span>}
          crumb="Edit article"
        />
        <p
          data-testid="kb-readonly-note"
          className="rounded-card border border-line bg-page px-4 py-3 text-sm text-body"
        >
          {PUBLISHER_NOTE}
        </p>
        <Card className="p-5" data-testid="kb-readonly">
          <p className="mb-4 text-base text-body">{data.summary}</p>
          <RichTextView html={data.bodyHtml} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        back={editing ? `/knowledge/${data.id}` : MY_ARTICLES}
        title={editing ? "Edit article" : "New article"}
      />
      <Card className="p-5">
        <ArticleForm key={id ?? "new"} article={data} options={list} />
      </Card>
    </div>
  );
}
