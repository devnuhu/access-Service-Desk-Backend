import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Search } from "lucide-react";
import { requestLink } from "../requestSearch.js";

const FILTER_FROM = 8;

/** One department's request types: each with its description and Raise; a filter past 8. */
function Types({ department }) {
  const id = useId();
  const [text, setText] = useState("");
  const many = department.categories.length > FILTER_FROM;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = department.categories.filter((c) => {
    const all = `${c.name} ${c.description ?? ""}`.toLowerCase();
    return words.every((w) => all.includes(w));
  });
  return (
    <div
      id={`${id}-types`}
      data-testid={`types-${department.departmentId}`}
      className="rounded-card border border-brand-navy/20 bg-white p-4 shadow-card sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{department.name}</h3>
        {many && (
          <div className="relative w-full sm:w-64">
            <Search
              aria-hidden="true"
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <label htmlFor={`${id}-filter`} className="sr-only">
              Filter {department.name} request types
            </label>
            <input
              id={`${id}-filter`}
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Filter these request types"
              className="h-9 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-sm"
            />
          </div>
        )}
      </div>
      {shown.length ? (
        <ul className="divide-y divide-line">
          {shown.map((category) => (
            <li
              key={category.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {category.name}
                </p>
                {category.description && (
                  <p className="mt-0.5 text-xs text-body">
                    {category.description}
                  </p>
                )}
              </div>
              <Link
                to={requestLink(category.id)}
                aria-label={`Raise ${category.name}`}
                className="inline-flex h-8 items-center rounded-lg bg-brand-navy px-3 text-xs font-semibold text-white hover:bg-brand-navy-dark"
              >
                Raise
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-muted">
          No request types match the filter.
        </p>
      )}
    </div>
  );
}

/**
 * The departments a person can raise requests with, as cards: name, how many request types, the
 * first three as a muted line. A card opens its request types underneath (one at a time). Names
 * all come from the catalogue; what is switched off or not ready never arrives.
 */
export default function DepartmentGrid({ departments, isSuperAdmin = false }) {
  const [open, setOpen] = useState(null);
  const shown = departments.filter((d) => d.categories.length);
  if (!shown.length)
    return (
      <p
        data-testid="no-services"
        className="rounded-card border border-dashed border-line bg-white px-5 py-6 text-sm text-body"
      >
        No services are available to request yet.
        {isSuperAdmin && (
          <>
            {" "}
            <Link
              to="/admin/categories"
              className="font-semibold text-brand-navy hover:underline"
            >
              Set up departments and categories
            </Link>
          </>
        )}
      </p>
    );
  const chosen = shown.find((d) => d.departmentId === open);
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((department) => {
          const expanded = department.departmentId === open;
          const count = department.categories.length;
          return (
            <li key={department.departmentId}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen(expanded ? null : department.departmentId)
                }
                className={`flex h-full w-full items-start justify-between gap-3 rounded-card border bg-white px-4 py-3.5 text-left shadow-card transition-colors hover:border-brand-navy ${expanded ? "border-brand-navy ring-1 ring-brand-navy" : "border-line"}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {department.name}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-brand-navy">
                    {count} request {count === 1 ? "type" : "types"}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted">
                    {department.categories
                      .slice(0, 3)
                      .map((c) => c.name)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  size={18}
                  className={`mt-0.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
      {chosen && <Types key={chosen.departmentId} department={chosen} />}
    </div>
  );
}
