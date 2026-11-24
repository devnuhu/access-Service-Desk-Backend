import { useState } from "react";
import { Link } from "react-router-dom";
import { PenLine, Search } from "lucide-react";
import { useCatalogue } from "@/features/catalogue";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { formatWatDay } from "@/shared/lib/time";
import { Card, InlineRetry, PageHeader, Spinner } from "@/shared/ui";
import KbPager from "../components/KbPager.jsx";
import {
  KB_PAGE_SIZE,
  useArticles,
  useIsKbWriter,
} from "../hooks/useKnowledge.js";

export const SEARCH_DELAY = 300;

function DepartmentChips({ departments, value, onChange }) {
  if (!departments.length) return null;
  const chip = (id, label, count) => {
    const on = value === id;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(id)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 ring-inset ${on ? "bg-brand-navy text-white ring-brand-navy" : "bg-white text-body ring-line hover:bg-page"}`}
      >
        {label}
        {count != null && (
          <span className={on ? "text-white/80" : "text-muted"}>{count}</span>
        )}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label="Department"
      data-testid="kb-departments"
      className="flex flex-wrap gap-2"
    >
      {chip("", "All departments", null)}
      {departments.map((d) => chip(d.id, d.name, d.count))}
    </div>
  );
}

/** A card: title (link), summary, department, category and the updated date. */
export function ArticleCard({ item }) {
  return (
    <li data-testid={`kb-article-${item.id}`}>
      <Card as="article" className="p-4">
        <h2 className="text-base font-semibold">
          <Link
            to={`/knowledge/${item.id}`}
            className="text-brand-navy hover:underline"
          >
            {item.title}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-body">{item.summary}</p>
        <p className="mt-2 flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{item.department.name}</span>
          {item.category && (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.category.name}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>Updated {formatWatDay(item.updatedAt)}</span>
        </p>
      </Card>
    </li>
  );
}

/**
 * The knowledge base (/knowledge), for everyone signed in: published articles only. Search
 * (debounced), department chips with their match counts (from the API, ignoring the department
 * filter), a category filter once a department is chosen, cards, and paging.
 */
export default function KnowledgePage() {
  const writer = useIsKbWriter();
  const [text, setText] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const key = `${search}|${departmentId}|${categoryId}`;
  const page = pageState.key === key ? pageState.page : 1;
  const list = useArticles({
    search,
    departmentId,
    categoryId,
    page,
    pageSize: KB_PAGE_SIZE,
  });
  const catalogue = useCatalogue({ enabled: Boolean(departmentId) });
  const categories =
    catalogue.data?.find((d) => d.departmentId === departmentId)?.categories ??
    [];
  const filtered = Boolean(search || departmentId || categoryId);
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge base"
        description="Answers written by each department's staff."
        actions={
          writer && (
            <Link
              to="/knowledge/manage"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-page"
            >
              <PenLine aria-hidden="true" size={16} />
              Write articles
            </Link>
          )
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search articles"
              placeholder="Search articles"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-sm text-ink"
            />
          </div>
          {departmentId && categories.length > 0 && (
            <select
              aria-label="Category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-11 min-w-0 rounded-lg border border-line bg-white px-3 text-sm text-ink"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <DepartmentChips
          departments={list.data?.departments ?? []}
          value={departmentId}
          onChange={(id) => {
            setDepartmentId(id);
            setCategoryId("");
          }}
        />
      </div>

      {list.isLoading ? (
        <div className="py-10 text-center text-muted">
          <Spinner label="Loading articles…" />
        </div>
      ) : list.isError ? (
        <InlineRetry
          testId="kb-error"
          message={list.error.message}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-muted">
          {filtered ? "No articles match your search." : "No articles yet."}
        </Card>
      ) : (
        <>
          <ul
            aria-label="Articles"
            className={`space-y-3 ${list.isPlaceholderData ? "opacity-60" : ""}`}
          >
            {items.map((item) => (
              <ArticleCard key={item.id} item={item} />
            ))}
          </ul>
          <KbPager
            total={list.data.total}
            page={page}
            pageSize={KB_PAGE_SIZE}
            onPage={(next) => setPageState({ page: next, key })}
          />
        </>
      )}
    </div>
  );
}
