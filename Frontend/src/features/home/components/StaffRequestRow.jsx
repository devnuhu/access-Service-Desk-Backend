import { Link } from "react-router-dom";
import { RequestSearch, useCatalogue } from "@/features/catalogue";
import { useDashboardSummary } from "../hooks/useDashboard.js";

function Count({ to, label, count, testId, tone }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm whitespace-nowrap text-body hover:border-brand-navy"
    >
      <span
        className={`font-semibold tabular-nums ${count > 0 && tone ? tone : "text-ink"}`}
      >
        {count ?? "–"}
      </span>{" "}
      {label}
    </Link>
  );
}

/**
 * For staff homes: one compact row to request something (the search) and my own requests (open,
 * waiting for my reply, waiting for my confirmation), so staff never hunt for it. No autofocus.
 */
export default function StaffRequestRow() {
  const catalogue = useCatalogue();
  const summary = useDashboardSummary();
  const mine = summary.data?.mine;
  return (
    <section
      aria-label="My requests"
      data-testid="staff-request-row"
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-2.5 shadow-card md:flex-row md:items-center"
    >
      <div className="min-w-0 flex-1">
        <RequestSearch departments={catalogue.data} compact />
      </div>
      <nav aria-label="My requests by state" className="flex flex-wrap gap-1.5">
        <Count
          to="/tickets?status=open"
          label="open requests"
          count={mine?.raisedOpen}
          testId="staff-raisedOpen"
        />
        <Count
          to="/tickets?status=4"
          label="waiting for my reply"
          count={mine?.waitingOnMe}
          testId="staff-waitingOnMe"
          tone="text-brand-orange-ink"
        />
        <Count
          to="/tickets?status=5"
          label="to confirm"
          count={mine?.toConfirm}
          testId="staff-toConfirm"
          tone="text-brand-orange-ink"
        />
      </nav>
    </section>
  );
}
