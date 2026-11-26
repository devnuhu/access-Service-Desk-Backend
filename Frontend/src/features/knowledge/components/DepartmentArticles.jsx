import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { formatWatDay } from "@/shared/lib/time";
import { Card, InlineRetry, Pager, Spinner } from "@/shared/ui";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import { useManagedArticles } from "../hooks/useKnowledge.js";
import { MY_ARTICLES } from "../places.js";
import KbStatusChip from "./KbStatusChip.jsx";

/** Opening an article from here: its Back and Delete return to this tab. */
const FROM_HERE = { from: MY_ARTICLES };

const STATUS_FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["published", "Published"],
];

export const NEW_ARTICLE_LINK =
  "inline-flex h-10 items-center gap-2 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-navy-dark";

/**
 * My department's articles: the second tab of /knowledge, for people who write for a department
 * (kb/options not empty; the parent shows the tab only then, so a requester never asks for drafts).
 * Drafts and published articles, status filter, search and New article. A table from md up, one
 * card per article below.
 */
export default function DepartmentArticles() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const paging = usePaging(`${search}|${status}`);
  const list = useManagedArticles({
    search,
    status,
    page: paging.page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, list.data?.total);

  const items = list.data?.items ?? [];
  return (
    <div className="space-y-4" data-testid="kb-mine">
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-0 flex-1 basis-56 self-start">
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
              className="h-10 w-full rounded-lg border border-line pr-3 pl-9 text-sm text-ink"
            />
          </div>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            {STATUS_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Link to="/knowledge/manage/new" className={NEW_ARTICLE_LINK}>
            <Plus aria-hidden="true" size={16} />
            New article
          </Link>
        </div>

        {list.isLoading ? (
          <div className="py-10 text-center text-muted">
            <Spinner label="Loading articles…" />
          </div>
        ) : list.isError ? (
          <div className="p-5">
            <InlineRetry
              testId="kb-manage-error"
              message={list.error.message}
              onRetry={() => list.refetch()}
            />
          </div>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {search || status
              ? "No articles match these filters."
              : "No articles yet."}
          </p>
        ) : (
          <div className={list.isPlaceholderData ? "opacity-60" : ""}>
            <table
              data-testid="kb-manage-table"
              className="hidden w-full text-left text-sm md:table"
            >
              <thead className="border-b border-line text-xs text-muted uppercase">
                <tr>
                  <th className="px-5 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Department</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-5 py-2 text-right font-semibold">
                    Helpful
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((item) => (
                  <tr key={item.id} data-testid={`kb-row-${item.id}`}>
                    <td className="px-5 py-3">
                      <Link
                        to={`/knowledge/${item.id}`}
                        state={FROM_HERE}
                        className="font-semibold text-brand-navy hover:underline"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-body">
                      {item.department.name}
                    </td>
                    <td className="px-3 py-3 text-body">
                      {item.category?.name ?? (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <KbStatusChip status={item.status} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-body">
                      {formatWatDay(item.updatedAt)}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap text-body">
                      <span aria-label={`${item.yes} yes, ${item.no} no`}>
                        {item.yes} yes · {item.no} no
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul
              data-testid="kb-manage-cards"
              className="divide-y divide-line md:hidden"
            >
              {items.map((item) => (
                <li key={item.id} className="px-5 py-3 text-sm">
                  <Link
                    to={`/knowledge/${item.id}`}
                    state={FROM_HERE}
                    className="font-semibold text-brand-navy hover:underline"
                  >
                    {item.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <KbStatusChip status={item.status} />
                    <span>{item.department.name}</span>
                    {item.category && <span>· {item.category.name}</span>}
                    <span>· {formatWatDay(item.updatedAt)}</span>
                    <span>
                      · {item.yes} yes · {item.no} no
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {items.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <Pager
              total={list.data.total}
              page={paging.page}
              onPage={paging.setPage}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
