import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useCatalogue } from "@/features/catalogue";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import { formatWatDay } from "@/shared/lib/time";
import { Card, InlineRetry, PageHeader, Pager, Spinner } from "@/shared/ui";
import DepartmentArticles from "../components/DepartmentArticles.jsx";
import { useArticles, useKbOptions } from "../hooks/useKnowledge.js";
import { LIBRARY, TAB_MINE } from "../places.js";

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
            state={{ from: LIBRARY }}
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

const TABS = [
  ["", "Library"],
  [TAB_MINE, "My department's articles"],
];

/**
 * The knowledge base (/knowledge), the one menu item. Everyone gets the library. People who write
 * for a department (kb/options not empty) also get a second tab, My department's articles, kept in
 * the address as ?tab=mine so Back and refresh keep it; only they ever ask for kb/manage.
 */
export default function KnowledgePage() {
  const options = useKbOptions();
  const writer = (options.data?.length ?? 0) > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = writer && searchParams.get("tab") === TAB_MINE ? TAB_MINE : "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge base"
        description="Answers written by each department's staff."
      />
      {writer && (
        <div
          role="tablist"
          aria-label="Which articles"
          className="flex gap-1 overflow-x-auto border-b border-line"
        >
          {TABS.map(([id, label]) => (
            <button
              key={id || "library"}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() =>
                setSearchParams(id ? { tab: id } : {}, { replace: false })
              }
              className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${tab === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Until options answer, the library shows: the default for everyone. */}
      {tab === TAB_MINE ? <DepartmentArticles /> : <Library />}
    </div>
  );
}

/**
 * The library: published articles only. Search (debounced), department chips with their match
 * counts (from the API, ignoring the department filter), a category filter once a department is
 * chosen, cards, and paging.
 */
function Library() {
  const [text, setText] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const paging = usePaging(`${search}|${departmentId}|${categoryId}`);
  const list = useArticles({
    search,
    departmentId,
    categoryId,
    page: paging.page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, list.data?.total);
  const catalogue = useCatalogue({ enabled: Boolean(departmentId) });
  const categories =
    catalogue.data?.find((d) => d.departmentId === departmentId)?.categories ??
    [];
  const filtered = Boolean(search || departmentId || categoryId);
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4" data-testid="kb-library">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1 basis-64 self-start">
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
          <Pager
            total={list.data.total}
            page={paging.page}
            onPage={paging.setPage}
          />
        </>
      )}
    </div>
  );
}
