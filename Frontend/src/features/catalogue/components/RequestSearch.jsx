import { useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import {
  highlightParts,
  requestLink,
  searchCatalogue,
} from "../requestSearch.js";

/** Text with the searched words marked. */
function Marked({ text, terms }) {
  return highlightParts(text, terms).map((part, i) =>
    part.hit ? (
      <mark
        key={i}
        className="rounded-sm bg-brand-orange-light px-px text-inherit"
      >
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );
}

/**
 * "What do you need help with?": a search over the request types the person can raise (the
 * catalogue), as a combobox with a list of up to 8 results. Arrow keys move, Enter opens the raise
 * form with that type chosen, Escape clears. `compact` is the one-line version on staff homes.
 */
export default function RequestSearch({
  departments,
  autoFocus = false,
  compact = false,
}) {
  const navigate = useNavigate();
  const ids = { input: useId(), list: useId(), status: useId() };
  const inputRef = useRef(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const results = searchCatalogue(departments ?? [], text);
  const open = text.trim().length > 0;
  const at = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (i) => `${ids.list}-${i}`;

  const choose = (result) => navigate(requestLink(result.category.id));
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActive((at + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActive((at - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && open && results[at]) {
      event.preventDefault();
      choose(results[at]);
    } else if (event.key === "Escape") {
      setText("");
      setActive(0);
    }
  };

  return (
    <div className="relative">
      <label
        htmlFor={ids.input}
        className={
          compact
            ? "sr-only"
            : "block text-base font-semibold text-ink sm:text-lg"
        }
      >
        What do you need help with?
      </label>
      <div className={`relative ${compact ? "" : "mt-2"}`}>
        <Search
          aria-hidden="true"
          size={compact ? 16 : 20}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted ${compact ? "left-3" : "left-4"}`}
        />
        <input
          ref={inputRef}
          id={ids.input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={ids.list}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results.length ? optionId(at) : undefined
          }
          aria-describedby={ids.status}
          autoComplete="off"
          // The requester home starts here; the staff row does not take the focus.
          autoFocus={autoFocus}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            compact
              ? "Request something: search, for example refund, statement"
              : "Search requests, for example refund, statement, access"
          }
          className={`w-full rounded-xl border border-line bg-white text-ink shadow-card placeholder:text-muted focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 focus:outline-none ${compact ? "h-10 pr-9 pl-9 text-sm" : "h-14 pr-12 pl-12 text-base"}`}
        />
        {text && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              setText("");
              inputRef.current?.focus();
            }}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-page hover:text-ink"
          >
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      <p id={ids.status} role="status" className="sr-only">
        {open
          ? results.length
            ? `${results.length} ${results.length === 1 ? "result" : "results"}. Use the arrow keys to move and Enter to open.`
            : departments == null
              ? "Loading the request types."
              : "Nothing matches."
          : ""}
      </p>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <ul
            id={ids.list}
            role="listbox"
            aria-label="Matching request types"
            className="max-h-[26rem] overflow-y-auto p-1"
          >
            {results.map((result, i) => (
              <li
                key={result.category.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === at}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(result)}
                className={`cursor-pointer rounded-lg px-3 py-2.5 ${i === at ? "bg-brand-navy-light" : ""}`}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-ink">
                    <Marked text={result.category.name} terms={result.terms} />
                  </span>
                  <span className="rounded bg-page px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line ring-inset">
                    <Marked
                      text={result.department.name}
                      terms={result.terms}
                    />
                  </span>
                </span>
                {result.category.description && (
                  <span className="mt-0.5 block truncate text-xs text-body">
                    <Marked
                      text={result.category.description}
                      terms={result.terms}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!results.length && departments == null && (
            <p className="px-4 py-3 text-sm text-muted">
              Loading the request types…
            </p>
          )}
          {!results.length && departments != null && (
            <p className="px-4 py-3 text-sm text-body">
              {compact
                ? "Nothing matches. You can "
                : "Nothing matches. Browse the departments below, or "}
              <Link
                to="/tickets/new"
                className="font-semibold text-brand-navy hover:underline"
              >
                raise a general request
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
