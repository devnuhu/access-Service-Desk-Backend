import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { Spinner } from "@/shared/ui";
import { MAX_CC } from "../api/endpoints.js";
import { useRecipientSearch } from "../hooks/useReports.js";

const DIRECTORY_DOWN =
  "The staff directory could not be searched right now. Try again.";

/**
 * "Copy to (optional)": people from the staff directory who get the same email, at most 10.
 * Type 2 or more characters (searched about 300 ms after typing stops); a person already chosen
 * (same email) is not added twice. `value` is [{ name, email }].
 */
export default function CcPicker({ value, onChange, error }) {
  const ids = { input: useId(), list: useId(), error: useId() };
  const [text, setText] = useState("");
  const query = useDebouncedValue(text.trim(), 300);
  const search = useRecipientSearch(query);
  const full = value.length >= MAX_CC;
  const chosen = new Set(value.map((p) => p.email.toLowerCase()));
  const results = (search.data ?? []).filter(
    (person) => !chosen.has(person.email.toLowerCase()),
  );
  const searchError =
    search.isError &&
    (search.error.status === 503 ? DIRECTORY_DOWN : search.error.message);

  const add = (person) => {
    if (full || chosen.has(person.email.toLowerCase())) return;
    onChange([...value, { name: person.displayName, email: person.email }]);
    setText("");
  };
  const remove = (email) =>
    onChange(
      value.filter((p) => p.email.toLowerCase() !== email.toLowerCase()),
    );

  const message = error || searchError;
  return (
    <div>
      <label
        htmlFor={ids.input}
        className="block text-sm font-semibold text-ink"
      >
        Copy to <span className="font-normal text-muted">(optional)</span>
      </label>

      {value.length > 0 && (
        <ul aria-label="People copied" className="mt-2 flex flex-wrap gap-1.5">
          {value.map((person) => (
            <li
              key={person.email}
              title={person.email}
              data-testid={`cc-${person.email}`}
              className="inline-flex items-center gap-1 rounded-full bg-brand-navy-light py-0.5 pr-1 pl-2.5 text-xs font-medium text-brand-navy ring-1 ring-brand-navy/15 ring-inset"
            >
              {person.name}
              <button
                type="button"
                onClick={() => remove(person.email)}
                aria-label={`Remove ${person.name}`}
                className="rounded-full p-0.5 hover:bg-white"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="mt-2 text-xs text-muted">You can copy up to 10 people.</p>
      ) : (
        <div className="relative mt-2">
          <Search
            aria-hidden="true"
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            id={ids.input}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search staff by name or email"
            autoComplete="off"
            aria-describedby={message ? ids.error : undefined}
            aria-invalid={error ? "true" : undefined}
            aria-controls={query.length >= 2 ? ids.list : undefined}
            className={`h-10 w-full rounded-lg border bg-white pr-3 pl-9 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
          />
          {query.length >= 2 && !searchError && (
            <div
              id={ids.list}
              className="absolute inset-x-0 top-11 z-20 max-h-56 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-xl"
            >
              {search.isLoading ? (
                <div className="px-3 py-3 text-center text-muted">
                  <Spinner label="Searching…" />
                </div>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted">
                  Nobody found with an email address.
                </p>
              ) : (
                <ul aria-label="Search results">
                  {results.map((person) => (
                    <li key={person.email}>
                      <button
                        type="button"
                        onClick={() => add(person)}
                        className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-page"
                      >
                        <span className="text-sm font-semibold text-ink">
                          {person.displayName}
                        </span>
                        <span className="text-xs text-muted">
                          {[person.email, person.jobTitle, person.department]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {message && (
        <p
          id={ids.error}
          role={searchError && !error ? "status" : undefined}
          className="mt-1 text-xs font-medium text-danger"
        >
          {message}
        </p>
      )}
      <p className="mt-1 text-xs text-muted">
        They get the same email and file as you, so they see what you can see.
      </p>
    </div>
  );
}
