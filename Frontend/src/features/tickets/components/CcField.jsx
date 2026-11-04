import { X } from "lucide-react";
import { PersonPicker } from "@/shared/ui";
import { MIN_QUERY } from "@/features/people";
import { MAX_CC } from "../ticketText.js";

/**
 * Copy colleagues: up to 10 people, for everyone raising a ticket. Takes the people search as
 * `search` (GET /api/people/search through searchColleagues); it starts at 2 characters. A
 * person is { id, fullName, userName, department }. `exclude` keeps out the person raising it
 * (and the requester when a Super Admin raises for someone else).
 */
export default function CcField({
  people,
  onChange,
  search,
  error,
  exclude = [],
}) {
  const full = people.length >= MAX_CC;
  return (
    <div>
      <p id="cc-label" className="text-sm font-semibold text-ink">
        Copy colleagues (CC){" "}
        <span className="font-normal text-muted">
          (optional, up to {MAX_CC})
        </span>
      </p>
      {people.length > 0 && (
        <ul aria-labelledby="cc-label" className="mt-2 flex flex-wrap gap-1.5">
          {people.map((person) => (
            <li
              key={person.id}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-page py-0.5 pr-1 pl-2.5 text-sm text-ink"
            >
              {person.fullName || person.userName}
              <button
                type="button"
                onClick={() =>
                  onChange(people.filter((p) => p.id !== person.id))
                }
                aria-label={`Remove ${person.fullName || person.userName} from CC`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-white hover:text-danger"
              >
                <X aria-hidden="true" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        {full ? (
          <p className="text-xs text-muted">
            {MAX_CC} people copied: the most a ticket takes.
          </p>
        ) : (
          <PersonPicker
            label="Add a colleague"
            search={search}
            onSelect={(person) => onChange([...people, person])}
            exclude={[...exclude, ...people.map((p) => p.id)]}
            queryKey={["tickets", "cc-search"]}
            minLength={MIN_QUERY}
            placeholder="Name or login name"
          />
        )}
      </div>
      {error && (
        <p id="cc-error" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
