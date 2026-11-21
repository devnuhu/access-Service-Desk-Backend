import { Link, useSearchParams } from "react-router-dom";
import {
  Building2,
  ClipboardList,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";
import { coverTitle, useCoverWarnings } from "@/features/admin-catalogue";
import { firstNameOf, useSession } from "@/features/auth";
import {
  describePlaces,
  headedUnits,
  memberUnits,
  oversees,
  useMyOrganisation,
} from "@/features/org";
import { RaiseTicketLink } from "@/features/tickets";
import { BRAND } from "@/shared/brand";
import { hasAnyRole, roleLabel, ROLES, sortRoles } from "@/shared/lib/roles";
import { Card, PageHeader, RoleChips, Spinner } from "@/shared/ui";
import Dashboard from "../components/Dashboard.jsx";
import DepartmentOverview from "../components/DepartmentOverview.jsx";
import MemberHome from "../components/MemberHome.jsx";
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
    </UnitDashboard>
  );
}

/** One line per role (BRD Section 4). Platform wording: no department names. */
const ROLE_CARDS = {
  [ROLES.Requester]: {
    icon: ClipboardList,
    text: "Raise requests to any department and follow each one until it is resolved.",
  },
  [ROLES.CaseWorker]: {
    icon: UserCog,
    text: "Work the requests assigned to you and keep them within their response and resolution times.",
  },
  [ROLES.HeadOfUnit]: {
    icon: Users,
    text: "Run your unit's queue: set up case workers, reassign work and handle first escalations.",
  },
  [ROLES.HOD]: {
    icon: Building2,
    text: "Oversee your department's requests and performance, and handle escalations that reach you.",
  },
  [ROLES.DepartmentAdmin]: {
    icon: Building2,
    text: "See every ticket in your department and reassign anywhere in it, as the HOD does.",
  },
  [ROLES.SuperAdmin]: {
    icon: ShieldCheck,
    text: `Manage people and roles, and keep ${BRAND.name} set up and running.`,
  },
};

/**
 * Home by what the person leads (org/me): an HOD, Department Admin or Super Admin oversees, and
 * gets the department overview (no My work: requesting stays on the Raise a ticket button); a unit
 * head gets their unit dashboard; a case worker their unit home (MemberHome); everyone else (a
 * requester) My work and what their roles can do.
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
  return <WorkHome org={org} />;
}

function Welcome({ user, children }) {
  return (
    <PageHeader
      title={`Welcome, ${firstNameOf(user)}`}
      crumb="Home"
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
      <CoverWarning enabled={isSuperAdmin} />
      <DepartmentOverview actions={<RaiseTicketLink />} />
    </div>
  );
}

function WorkHome({ org }) {
  const { user } = useSession();
  const roles = sortRoles(user.roles);
  // A unit member's Work queue opens on "Assigned to me": the My work tiles link there.
  const memberDepartment = org?.departments.find((department) =>
    department.units.some((unit) => unit.isMember),
  );
  const places = describePlaces(org);

  return (
    <div className="space-y-6">
      <Welcome user={user}>
        <RoleChips roles={roles} className="mt-3" />
        {places.length > 0 && (
          <ul
            className="mt-3 space-y-0.5 text-sm text-body"
            aria-label="Your place"
          >
            {places.map((place) => (
              <li key={place}>{place}</li>
            ))}
          </ul>
        )}
      </Welcome>

      <Dashboard
        departmentId={memberDepartment?.id}
        actions={<RaiseTicketLink />}
      />

      <section aria-labelledby="home-roles">
        <h2 id="home-roles" className="text-base font-semibold">
          What you can do
        </h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles
            .filter((role) => ROLE_CARDS[role])
            .map((role) => {
              const { icon: Icon, text } = ROLE_CARDS[role];
              return (
                <li key={role}>
                  <Card as="div" className="flex h-full gap-3 px-5 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy-light text-brand-navy">
                      <Icon aria-hidden="true" size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">
                        {roleLabel(role)}
                      </h3>
                      <p className="mt-1 text-sm text-body">{text}</p>
                    </div>
                  </Card>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
