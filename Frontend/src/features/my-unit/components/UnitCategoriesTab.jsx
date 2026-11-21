import { Fragment, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { Card, Chip, Spinner } from "@/shared/ui";
import { useMyUnitSkills, useUnitCategories } from "../hooks/useMyUnit.js";

const th =
  "px-4 py-3 text-[11px] font-semibold tracking-wider text-muted uppercase";

/**
 * The unit's categories (its functions), read only: the Super Admin creates and edits them. A row
 * opens to show who handles it (from the skills matrix).
 */
export default function UnitCategoriesTab({ unitId }) {
  const categories = useUnitCategories(unitId);
  const skills = useMyUnitSkills(unitId);
  const [open, setOpen] = useState(null);

  const handlers = (categoryId) =>
    (skills.data?.members ?? []).filter((m) =>
      m.categoryIds.includes(categoryId),
    );

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-muted">
        <Info aria-hidden="true" size={16} className="text-brand-navy" />
        Categories are set by the Super Admin. Who handles each one is set in
        Team and skills.
      </p>
      <Card className="overflow-x-auto">
        {categories.isLoading ? (
          <div className="px-5 py-10 text-center text-muted">
            <Spinner label="Loading categories…" />
          </div>
        ) : categories.isError ? (
          <p
            role="alert"
            className="px-5 py-10 text-center text-sm text-danger"
          >
            {categories.error.message}
          </p>
        ) : categories.data.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            This unit owns no categories yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-page/60">
              <tr>
                <th scope="col" className={th}>
                  Category
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Timeline
                </th>
                <th scope="col" className={th}>
                  Default priority
                </th>
                <th scope="col" className={th}>
                  Handled by
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {categories.data.map((category) => {
                const expanded = open === category.id;
                const people = handlers(category.id);
                return (
                  <Fragment key={category.id}>
                    <tr
                      data-testid={`category-${category.name}`}
                      className={category.isActive ? "" : "text-muted"}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={`handlers-${category.id}`}
                          onClick={() => setOpen(expanded ? null : category.id)}
                          className="flex items-start gap-1.5 text-left font-semibold text-ink hover:text-brand-navy"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            size={16}
                            className={`mt-0.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                          <span>
                            {category.name}
                            {category.description && (
                              <span className="block text-xs font-normal text-muted">
                                {category.description}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {category.timelineHours} h
                      </td>
                      <td className="px-4 py-3">
                        <PriorityChip priority={category.defaultPriority} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap items-center gap-2">
                          {category.eligibleCount}{" "}
                          {category.eligibleCount === 1 ? "person" : "people"}
                          {category.needsCover && (
                            <Chip tone="red">Needs cover</Chip>
                          )}
                          {!category.isActive && (
                            <Chip tone="grey">Switched off</Chip>
                          )}
                        </span>
                      </td>
                    </tr>
                    {expanded && (
                      <tr id={`handlers-${category.id}`} className="bg-page/50">
                        <td colSpan={4} className="px-4 py-3 pl-10">
                          {skills.isLoading ? (
                            <Spinner label="Loading…" />
                          ) : people.length ? (
                            <ul
                              aria-label={`Who handles ${category.name}`}
                              className="flex flex-wrap gap-2"
                            >
                              {people.map((person) => (
                                <li key={person.userId}>
                                  <Chip
                                    tone={
                                      person.accountActive ? "navy" : "grey"
                                    }
                                  >
                                    {person.fullName || person.userName}
                                  </Chip>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted">
                              Nobody handles it yet.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
