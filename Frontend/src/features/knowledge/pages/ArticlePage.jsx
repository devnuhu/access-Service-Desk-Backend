import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Pencil,
  SearchX,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import {
  Button,
  Card,
  ConfirmDialog,
  MessageCard,
  PageHeader,
  RichTextView,
  Spinner,
  useToast,
} from "@/shared/ui";
import { KB_STATUS } from "../api/endpoints.js";
import KbStatusChip from "../components/KbStatusChip.jsx";
import { LIBRARY } from "../places.js";

/** The knowledge base tab the article was opened from (link state), else the library. */
function useCameFrom() {
  const { state } = useLocation();
  return typeof state?.from === "string" && state.from.startsWith(LIBRARY)
    ? state.from
    : LIBRARY;
}
import {
  useArticle,
  useDeleteArticle,
  usePublishArticle,
  useVote,
} from "../hooks/useKnowledge.js";

const personName = (person) => person?.fullName || person?.userName || "";

/**
 * "Was this helpful?" Yes / No. My answer is highlighted (aria-pressed); the other one changes it.
 * Counts are always the ones the call returns, and the buttons wait for it, so nothing stacks.
 */
function Helpful({ article }) {
  const toast = useToast();
  const vote = useVote(article.id);
  const [thanked, setThanked] = useState(false);
  const answer = async (helpful) => {
    if (article.myVote === helpful || vote.isPending) return;
    try {
      await vote.mutateAsync(helpful);
      setThanked(true);
    } catch (error) {
      toast.error(error.message);
    }
  };
  const button = (helpful, label, Icon) => {
    const on = article.myVote === helpful;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={vote.isPending}
        onClick={() => answer(helpful)}
        className={`inline-flex min-h-11 min-w-20 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold ring-1 ring-inset disabled:cursor-wait ${on ? "bg-brand-navy text-white ring-brand-navy" : "bg-white text-brand-navy ring-line hover:bg-page"}`}
      >
        <Icon aria-hidden="true" size={16} />
        {label}
      </button>
    );
  };
  return (
    <Card
      className="p-5"
      aria-labelledby="helpful-heading"
      data-testid="kb-helpful"
    >
      <h2 id="helpful-heading" className="text-base font-semibold">
        Was this helpful?
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {button(true, "Yes", ThumbsUp)}
        {button(false, "No", ThumbsDown)}
      </div>
      <div aria-live="polite" className="mt-2 text-sm text-body">
        {thanked && <p>Thanks for the feedback.</p>}
        {article.myVote != null && (
          <p data-testid="kb-helpful-count" className="text-muted">
            {article.yes} found this helpful
          </p>
        )}
      </div>
    </Card>
  );
}

/** Edit, Publish or Unpublish, Delete (with a confirm): each only when the API allows it. */
function ArticleActions({ article }) {
  const toast = useToast();
  const navigate = useNavigate();
  const from = useCameFrom();
  const publish = usePublishArticle();
  const remove = useDeleteArticle();
  const [confirming, setConfirming] = useState(false);
  const published = article.status === KB_STATUS.Published;

  const togglePublish = async () => {
    try {
      await publish.mutateAsync({ id: article.id, publish: !published });
      toast.success(published ? "Back to draft." : "Article published.");
    } catch (error) {
      toast.error(error.message);
    }
  };
  const confirmDelete = async () => {
    try {
      const result = await remove.mutateAsync(article.id);
      toast.success(result.message);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(error.message);
      setConfirming(false);
    }
  };

  if (!article.canEdit && !article.canPublish && !article.canDelete)
    return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="kb-actions">
      {article.canEdit && (
        <Link
          to={`/knowledge/manage/${article.id}/edit`}
          state={{ from }}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-page"
        >
          <Pencil aria-hidden="true" size={15} />
          Edit
        </Link>
      )}
      {article.canPublish && (
        <Button
          variant={published ? "secondary" : "primary"}
          busy={publish.isPending}
          onClick={togglePublish}
        >
          {published ? (
            <>
              <EyeOff aria-hidden="true" size={15} />
              Unpublish
            </>
          ) : (
            <>
              <Eye aria-hidden="true" size={15} />
              Publish
            </>
          )}
        </Button>
      )}
      {article.canDelete && (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" size={15} />
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title="Delete this article?"
        message={`“${article.title}” is removed for everyone. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** One article (/knowledge/:id). A draft is 404 outside its department; the page does not say which. */
export default function ArticlePage() {
  const { id } = useParams();
  const from = useCameFrom();
  const query = useArticle(id);

  if (query.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the article…" />
      </div>
    );
  }
  if (query.isError) {
    return query.error.status === 404 ? (
      <MessageCard
        icon={SearchX}
        title="Article not found"
        linkTo="/knowledge"
        linkText="Go to the knowledge base"
      >
        <p>This article does not exist, or it is not published.</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {query.error.message}
      </p>
    );
  }

  const article = query.data;
  const draft = article.status !== KB_STATUS.Published;
  const updated = article.updatedAt ?? article.publishedAt ?? article.createdAt;

  return (
    <div className="space-y-4">
      <PageHeader
        back={from}
        title={<span className="break-words">{article.title}</span>}
        crumb={article.title}
        actions={<ArticleActions article={article} />}
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-body">
          {draft && <KbStatusChip status={article.status} />}
          <span>{article.department.name}</span>
          {article.category && (
            <>
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
              <span>{article.category.name}</span>
            </>
          )}
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <span data-testid="kb-updated">Updated {formatWat(updated)}</span>
          {article.author && (
            <span className="text-muted">by {personName(article.author)}</span>
          )}
        </div>
      </PageHeader>

      {draft && (
        <p
          data-testid="kb-draft-banner"
          className="rounded-card border border-brand-orange bg-brand-orange-light px-4 py-3 text-sm font-medium text-brand-orange-ink"
        >
          Draft – only your department can see this.
        </p>
      )}

      <Card className="p-5">
        <p className="mb-4 text-base text-body">{article.summary}</p>
        <RichTextView html={article.bodyHtml} />
      </Card>

      {!draft && <Helpful article={article} />}
    </div>
  );
}
