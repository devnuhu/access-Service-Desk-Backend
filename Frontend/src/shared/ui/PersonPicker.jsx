import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import Spinner from "./Spinner.jsx";

/**
 * Search box over people (debounced 300 ms) with a result list. Shared code does not call feature
 * APIs, so the caller passes `search(text) => Promise<person[]>` (a person has id, fullName,
 * userName, department) and, in `footer`, anything to show under the results (for example the
 * "Not listed? Add from directory" link).
 *
 * @param {{
 *   label?: string,
 *   search: (text: string) => Promise<any[]>,
 *   onSelect: (person: any) => void,
 *   selectedId?: string | null,
 *   exclude?: string[],
 *   footer?: import("react").ReactNode,
 *   queryKey?: unknown[],
 * }} props
 */
export default function PersonPicker({
  label = "Find a person",
  search,
  onSelect,
  selectedId,
  exclude = [],
  footer,
  queryKey = ["person-picker"],
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  const query = useDebouncedValue(text.trim(), 300);
  const results = useQuery({
    queryKey: [...queryKey, query],
    queryFn: () => search(query),
    enabled: query.length > 0,
    staleTime: 30_000,
  });
  const people = (results.data ?? []).filter(
    (person) => !exclude.includes(person.id),
  );

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative mt-1">
        <Search
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
        />
        <input
          id={inputId}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Name, login name, email or department"
          autoComplete="off"
          className="h-10 w-full rounded-[6px] border border-line pr-3 pl-9 text-sm text-ink"
        />
      </div>

      <div className="mt-2" aria-live="polite">
        {!query ? null : results.isFetching && !results.data ? (
          <Spinner label="Searching…" className="py-2 text-sm text-muted" />
        ) : results.isError ? (
          <p role="alert" className="py-2 text-sm text-danger">
            {results.error.message}
          </p>
        ) : people.length === 0 ? (
          <p className="py-2 text-sm text-muted">No one matches “{query}”.</p>
        ) : (
          <ul
            className="max-h-64 divide-y divide-line overflow-y-auto rounded-[6px] border border-line"
            aria-label="Matching people"
          >
            {people.map((person) => {
              const selected = person.id === selectedId;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(person)}
                    aria-pressed={selected}
                    className={`block w-full px-3 py-2 text-left hover:bg-page ${selected ? "bg-brand-navy-light" : ""}`}
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {person.fullName || person.userName}
                    </span>
                    <span className="block text-xs text-muted">
                      {[person.userName, person.department]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footer && <div className="mt-2 text-sm">{footer}</div>}
    </div>
  );
}
