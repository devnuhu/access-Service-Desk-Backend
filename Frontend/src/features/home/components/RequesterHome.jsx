import { firstNameOf, useSession } from "@/features/auth";
import {
  DepartmentGrid,
  RequestSearch,
  SuggestionChips,
  useCatalogue,
} from "@/features/catalogue";
import { MyRequestsStrip, RaiseTicketLink } from "@/features/tickets";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { InlineRetry, PageHeader } from "@/shared/ui";
import { useDashboardSummary } from "../hooks/useDashboard.js";
import RequesterAttention from "./RequesterAttention.jsx";

function DepartmentsSkeleton() {
  return (
    <ul
      aria-hidden="true"
      data-testid="departments-loading"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-[5.25rem] animate-pulse rounded-card border border-line bg-white"
        />
      ))}
    </ul>
  );
}

/**
 * Home for someone who only raises requests: search first (what do you need help with?), quick
 * picks, what needs their attention, their latest open requests, then the departments to browse.
 * Each block loads on its own; one failing call shows a small retry and leaves the rest.
 */
export default function RequesterHome() {
  const { user } = useSession();
  const catalogue = useCatalogue();
  const summary = useDashboardSummary();
  const mine = summary.data?.mine;
  const attention = Boolean(
    (mine && (mine.waitingOnMe > 0 || mine.toConfirm > 0)) ||
    (summary.isError && !summary.data),
  );
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${firstNameOf(user)}`}
        crumb="Home"
        description="Find what you need, raise a request and follow it here."
        actions={<RaiseTicketLink />}
      />

      <section
        aria-label="Request something"
        data-testid="request-something"
        className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card sm:p-6"
      >
        <RequestSearch departments={catalogue.data} autoFocus />
        {catalogue.isError && (
          <InlineRetry
            message="The request types could not be loaded."
            onRetry={() => catalogue.refetch()}
          />
        )}
        <SuggestionChips />
      </section>

      <div
        className={`grid gap-4 ${attention ? "lg:grid-cols-2 lg:items-start" : ""}`}
      >
        {attention && <RequesterAttention />}
        <MyRequestsStrip />
      </div>

      <section aria-labelledby="home-departments" className="space-y-3">
        <h2 id="home-departments" className="text-base font-semibold">
          Browse by department
        </h2>
        {catalogue.isLoading ? (
          <DepartmentsSkeleton />
        ) : catalogue.isError ? (
          <InlineRetry
            message="The departments could not be loaded."
            onRetry={() => catalogue.refetch()}
            testId="departments-error"
          />
        ) : (
          <DepartmentGrid
            departments={catalogue.data}
            isSuperAdmin={isSuperAdmin}
          />
        )}
      </section>
    </div>
  );
}
