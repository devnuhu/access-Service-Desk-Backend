import { Fragment, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { TemplateEditorDialog } from "@/features/category-templates";
import { Card, Chip, Spinner } from "@/shared/ui";
import { useMyUnitSkills, useUnitCategories } from "../hooks/useMyUnit.js";

const th =
  "px-4 py-3 text-[11px] font-semibold tracking-wider text-muted uppercase";

/**
 * The unit's categories (its functions), read only: the Super Admin creates and edits them. A row
 * opens to show who handles it (from the skills matrix).
 */
export default function UnitCategoriesTab({
  unitId,
  canEditTemplates = false,
}) {
  const categories = useUnitCategories(unitId);
  const skills = useMyUnitSkills(unitId);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);

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
        {canEditTemplates &&
          " You can give each one a template: the text requesters start from."}
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
                <th
                  scope="col"
                  className={th}
                  title="Used only when a ticket is raised without the impact and urgency answers"
                >
                  Default priority
                </th>
                <th scope="col" className={th}>
                  Handled by
                </th>
                {canEditTemplates && (
                  <th scope="col" className={th}>
                    <span className="sr-only">Template</span>
                  </th>
                )}
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
                      {canEditTemplates && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setEditing(category)}
                            aria-label={`Template of ${category.name}`}
                            className="inline-flex h-8 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:border-brand-navy"
                          >
                            Template
                          </button>
                        </td>
                      )}
                    </tr>
                    {expanded && (
                      <tr id={`handlers-${category.id}`} className="bg-page/50">
                        <td
                          colSpan={canEditTemplates ? 4 : 3}
                          className="px-4 py-3 pl-10"
                        >
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
      {editing && (
        <TemplateEditorDialog
          category={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
