import { Link } from "react-router-dom";
import { Clock3, TrendingUp } from "lucide-react";
import { useCatalogueSuggestions } from "../hooks/useCatalogue.js";
import { requestLink } from "../requestSearch.js";

function Row({ id, icon: Icon, title, items }) {
  if (!items.length) return null;
  return (
    <div
      data-testid={id}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Icon aria-hidden="true" size={14} />
        {title}
      </span>
      <ul aria-label={title} className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.categoryId}>
            <Link
              to={requestLink(item.categoryId)}
              title={item.departmentName}
              aria-label={`${item.categoryName} (${item.departmentName})`}
              className="inline-flex h-8 items-center rounded-full border border-line bg-white px-3 text-sm font-medium text-brand-navy hover:border-brand-navy hover:bg-brand-navy-light"
            >
              {item.categoryName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Quick picks under the search: "Your recent requests" and "Popular right now" (each hidden when
 * empty). A chip opens the raise form with that request type chosen. Quiet while loading; a
 * failure hides them (the search and the departments still work).
 */
export default function SuggestionChips() {
  const suggestions = useCatalogueSuggestions();
  if (suggestions.isLoading)
    return (
      <div
        aria-hidden="true"
        className="flex gap-2"
        data-testid="suggestions-loading"
      >
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-8 w-28 animate-pulse rounded-full bg-line/70"
          />
        ))}
      </div>
    );
  if (!suggestions.data) return null;
  const { recent, popular } = suggestions.data;
  if (!recent.length && !popular.length) return null;
  return (
    <div className="space-y-2">
      <Row
        id="suggestions-recent"
        icon={Clock3}
        title="Your recent requests"
        items={recent}
      />
      <Row
        id="suggestions-popular"
        icon={TrendingUp}
        title="Popular right now"
        items={popular}
      />
    </div>
  );
}
