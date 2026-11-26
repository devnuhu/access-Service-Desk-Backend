import { Link, useSearchParams } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { coverTitle, useCoverWarnings } from "@/features/admin-catalogue";
import { firstNameOf, useSession } from "@/features/auth";
import {
  headedUnits,
  memberUnits,
  oversees,
  useMyOrganisation,
} from "@/features/org";
import { RaiseTicketLink } from "@/features/tickets";
import { hasAnyRole, ROLES, sortRoles } from "@/shared/lib/roles";
import { PageHeader, RoleChips, Spinner } from "@/shared/ui";
import DepartmentOverview from "../components/DepartmentOverview.jsx";
import MemberHome from "../components/MemberHome.jsx";
import RequesterHome from "../components/RequesterHome.jsx";
import StaffRequestRow from "../components/StaffRequestRow.jsx";
import UnitDashboard from "../components/UnitDashboard.jsx";

/**
 * A head's home is their unit dashboard; a head of several units switches with ?unit= (the first
 * unit when none is asked).
 */
function HeadHome({ units }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("unit");
  const unit = units.find((u) => u.id === asked) ?? units[0];
  return (
    <UnitDashboard
      key={unit.id}
      unitId={unit.id}
      own
      actions={<RaiseTicketLink />}
    >
      {units.length > 1 && (
        <div
          role="group"
          aria-label="Your units"
          className="mt-4 inline-flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1"
        >
          {units.map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={u.id === unit.id}
              onClick={() => setParams({ unit: u.id }, { replace: true })}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${u.id === unit.id ? "bg-brand-navy text-white" : "text-body hover:bg-page"}`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4">
        <StaffRequestRow />
      </div>
    </UnitDashboard>
  );
}

/**
 * Home by what the person leads (org/me): an HOD, Department Admin or Super Admin oversees, and
 * gets the department overview; a unit head gets their unit dashboard; a case worker their unit
 * home (MemberHome). Each of those has a compact row on top to request something and see their own
 * requests. Everyone else (a plain requester) gets the Requester Home: search first, departments
 * second, their requests.
 */
export default function HomePage() {
  const { user } = useSession();
  const orgQuery = useMyOrganisation();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  if (orgQuery.isLoading)
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  const org = orgQuery.data;
  if (oversees(org, isSuperAdmin)) return <OverviewHome />;
  const units = headedUnits(org);
  if (units.length) return <HeadHome units={units} />;
  const worksIn = memberUnits(org);
  if (worksIn.length) return <MemberHome units={worksIn} />;
  return <RequesterHome />;
}

function Welcome({ user, children }) {
  return (
    <PageHeader
      title={`Welcome, ${firstNameOf(user)}`}
      crumb="Dashboard"
      description={
        [user.department, user.jobTitle].filter(Boolean).join(" · ") ||
        "Access Pensions"
      }
    >
      {children}
    </PageHeader>
  );
}

function CoverWarning({ enabled }) {
  const { data: coverWarnings } = useCoverWarnings({ enabled });
  if (!enabled || !coverWarnings?.length) return null;
  return (
    <section
      aria-labelledby="home-cover"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-orange bg-brand-orange-light px-5 py-4"
    >
      <div className="flex gap-3">
        <TriangleAlert
          aria-hidden="true"
          size={20}
          className="mt-0.5 shrink-0 text-brand-orange-ink"
        />
        <div>
          <h2
            id="home-cover"
            className="text-sm font-semibold text-brand-orange-ink"
          >
            Categories needing cover
          </h2>
          <p className="mt-0.5 text-sm text-ink">
            {coverTitle(coverWarnings.length)}.
          </p>
        </div>
      </div>
      <Link
        to="/admin/categories"
        className="text-sm font-semibold text-brand-navy hover:underline"
      >
        Open Categories
      </Link>
    </section>
  );
}

/** HOD, Department Admin, Super Admin: the overview of every unit they oversee. */
function OverviewHome() {
  const { user } = useSession();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  return (
    <div className="space-y-6">
      <Welcome user={user}>
        <RoleChips roles={sortRoles(user.roles)} className="mt-3" />
      </Welcome>
      <StaffRequestRow />
      <CoverWarning enabled={isSuperAdmin} />
      <DepartmentOverview actions={<RaiseTicketLink />} />
    </div>
  );
}
