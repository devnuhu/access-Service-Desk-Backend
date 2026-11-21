import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, Spinner } from "@/shared/ui";
import { formatWatClock } from "@/shared/lib/time";
import { useDashboardSummary } from "../hooks/useDashboard.js";
import { unitDashboardPath } from "../links.js";

const COLUMNS = [
  ["open", "Open"],
  ["unassigned", "Unassigned"],
  ["waitingToStart", "Waiting to start"],
  ["overdue", "Overdue"],
  ["farPast", "Far past"],
  ["escalated", "Escalated"],
];

/** Past the deadline in red, the rest amber; 0 is grey. */
const TONES = {
  overdue: "text-danger",
  farPast: "text-danger",
  unassigned: "text-brand-orange-ink",
  escalated: "text-brand-orange-ink",
};
const cellTone = (key, count) =>
  count === 0
    ? "text-muted"
    : TONES[key]
      ? `font-semibold ${TONES[key]}`
      : "text-ink";

const th =
  "px-4 py-3 text-[11px] font-semibold tracking-wider text-muted uppercase";

/**
 * The HOD's, Department Admin's and Super Admin's home: one row per unit they oversee
 * (GET /api/dashboard/summary `overview`), with a total row. A row opens the unit's dashboard.
 * With units from more than one department (Super Admin) a Department column says whose.
 */
export default function DepartmentOverview({ actions }) {
  const navigate = useNavigate();
  const summary = useDashboardSummary();
  const data = summary.data;
  const overview = data?.overview;
  const units = overview?.units ?? [];
  const manyDepartments =
    new Set(units.map((unit) => unit.departmentId)).size > 1;

  return (
    <section aria-labelledby="home-overview" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 id="home-overview" className="text-base font-semibold">
            {manyDepartments ? "Overview" : "Department overview"}
          </h2>
          {data && (
            <span className="text-xs text-muted">
              Updated {formatWatClock(data.generatedAt)}
            </span>
          )}
        </div>
        {actions}
      </div>

      {summary.isLoading ? (
        <div className="py-6 text-center text-muted">
          <Spinner label="Loading the overview…" />
        </div>
      ) : summary.isError && !data ? (
        <p role="alert" className="text-sm text-danger">
          {summary.error.message}
        </p>
      ) : !units.length ? (
        <Card className="px-5 py-6 text-sm text-muted">
          There are no active units to show yet.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-page/60">
              <tr>
                <th scope="col" className={th}>
                  Unit
                </th>
                {manyDepartments && (
                  <th scope="col" className={th}>
                    Department
                  </th>
                )}
                {COLUMNS.map(([key, label]) => (
                  <th key={key} scope="col" className={`${th} text-right`}>
                    {label}
                  </th>
                ))}
                <th scope="col" className="w-10">
                  <span className="sr-only">Dashboard</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {units.map((unit) => (
                <tr
                  key={unit.unitId}
                  data-testid={`unit-${unit.unitName}`}
                  onClick={() => navigate(unitDashboardPath(unit.unitId))}
                  className="cursor-pointer hover:bg-brand-navy-light/40"
                >
                  <th scope="row" className="px-4 py-3 font-semibold">
                    <Link
                      to={unitDashboardPath(unit.unitId)}
                      className="text-brand-navy hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {unit.unitName}
                    </Link>
                  </th>
                  {manyDepartments && (
                    <td className="px-4 py-3 text-body">
                      {unit.departmentName}
                    </td>
                  )}
                  {COLUMNS.map(([key]) => (
                    <td
                      key={key}
                      className={`px-4 py-3 text-right tabular-nums ${cellTone(key, unit[key])}`}
                    >
                      {unit[key]}
                    </td>
                  ))}
                  <td className="pr-3 text-muted">
                    <ChevronRight aria-hidden="true" size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-page/60">
              <tr data-testid="overview-total">
                <th scope="row" className="px-4 py-3 font-semibold">
                  Total
                </th>
                {manyDepartments && <td />}
                {COLUMNS.map(([key]) => (
                  <td
                    key={key}
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${overview.total[key] === 0 ? "text-muted" : (TONES[key] ?? "text-ink")}`}
                  >
                    {overview.total[key]}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </section>
  );
}
