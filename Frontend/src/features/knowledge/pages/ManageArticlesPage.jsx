import { useState } from "react";
import { Link } from "react-router-dom";
import { PenLine, Plus, Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { formatWatDay } from "@/shared/lib/time";
import {
  Card,
  InlineRetry,
  MessageCard,
  PageHeader,
  Spinner,
} from "@/shared/ui";
import KbPager from "../components/KbPager.jsx";
import KbStatusChip from "../components/KbStatusChip.jsx";
import {
  KB_PAGE_SIZE,
  useKbOptions,
  useManagedArticles,
} from "../hooks/useKnowledge.js";
import { SEARCH_DELAY } from "./KnowledgePage.jsx";

const STATUS_FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["published", "Published"],
];

export const NEW_ARTICLE_LINK =
  "inline-flex h-10 items-center gap-2 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-navy-dark";

/**
 * Write articles (/knowledge/manage): drafts and published articles of the departments I write
 * for. A table from md up, one card per article below. Without options (a requester) the list is
 * never asked for.
 */
export default function ManageArticlesPage() {
  const options = useKbOptions();
  const writer = (options.data?.length ?? 0) > 0;
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DELAY);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const key = `${search}|${status}`;
  const page = pageState.key === key ? pageState.page : 1;
  const list = useManagedArticles(
    { search, status, page, pageSize: KB_PAGE_SIZE },
    { enabled: writer },
  );

  if (options.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!writer) {
    return (
      <MessageCard
        icon={PenLine}
        title="Write articles"
        linkTo="/knowledge"
        linkText="Go to the knowledge base"
      >
        <p>You do not write articles for any department.</p>
      </MessageCard>
    );
  }

  const items = list.data?.items ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Write articles"
        description="Drafts and published articles of your departments."
        trail={[{ label: "Knowledge base", to: "/knowledge" }]}
        actions={
          <Link to="/knowledge/manage/new" className={NEW_ARTICLE_LINK}>
            <Plus aria-hidden="true" size={16} />
            New article
          </Link>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-0 flex-1 basis-56">
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
            <KbPager
              total={list.data.total}
              page={page}
              pageSize={KB_PAGE_SIZE}
              onPage={(next) => setPageState({ page: next, key })}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
