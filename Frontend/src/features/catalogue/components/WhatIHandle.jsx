import { Card, CardHeader, Spinner } from "@/shared/ui";
import { useMyCategories } from "../hooks/useCatalogue.js";

/** My availability: the categories I handle, by unit. Read-only: heads and Super Admin map them. */
export default function WhatIHandle() {
  const query = useMyCategories();

  return (
    <Card aria-labelledby="what-i-handle">
      <div id="what-i-handle">
        <CardHeader
          title="What I handle"
          description="Ask your head of unit to change these."
        />
      </div>
      <div className="px-5 py-4">
        {query.isLoading ? (
          <Spinner label="Loading…" className="text-sm text-muted" />
        ) : query.isError ? (
          <p role="alert" className="text-sm text-danger">
            {query.error.message}
          </p>
        ) : query.data.length === 0 ? (
          <p className="text-sm text-muted">No categories yet.</p>
        ) : (
          <div className="space-y-4">
            {query.data.map((unit) => (
              <section key={unit.unitId} data-testid={`handles-${unit.unitId}`}>
                <h3 className="text-sm font-semibold">
                  {unit.unitName}{" "}
                  <span className="font-normal text-muted">
                    {unit.departmentName}
                  </span>
                </h3>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                  {unit.categories.map((category) => (
                    <li
                      key={category.id}
                      className={category.isActive ? "" : "text-muted"}
                    >
                      {category.name}
                      {!category.isActive && " (off)"}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
