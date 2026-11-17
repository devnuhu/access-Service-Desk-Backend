import { Link } from "react-router-dom";
import {
  Building2,
  ClipboardList,
  FileText,
  Hourglass,
  Inbox,
  Play,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
  UserCheck,
} from "lucide-react";
import { coverTitle, useCoverWarnings } from "@/features/admin-catalogue";
import { firstNameOf, useSession } from "@/features/auth";
import { describePlaces, useMyOrganisation } from "@/features/org";
import { RaiseTicketLink, STATUS, useTicketList } from "@/features/tickets";
import { hasAnyRole, roleLabel, ROLES, sortRoles } from "@/shared/lib/roles";
import { Card, RoleChips } from "@/shared/ui";

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
    text: "Manage people and roles, and keep Access Desk set up and running.",
  },
};

function CountCard({ icon: Icon, title, count, to, linkText, testId }) {
  return (
    <li>
      <Card as="div" className="flex h-full items-center gap-4 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-navy-light text-brand-navy">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-2xl font-semibold text-ink" data-testid={testId}>
            {count ?? "—"}
          </p>
        </div>
        <Link
          to={to}
          className="text-sm font-semibold whitespace-nowrap text-brand-navy hover:underline"
        >
          {linkText} <span className="sr-only">({title})</span>
        </Link>
      </Card>
    </li>
  );
}

/** A count needs no rows: the smallest page, and read its total. */
const ONE_ROW_OF = (query) => ({ ...query, page: 1, pageSize: 1 });

function MyOpenRequests() {
  const open = useTicketList(ONE_ROW_OF({ view: "mine", open: true }));
  return (
    <CountCard
      icon={FileText}
      title="My open requests"
      count={open.data?.total ?? null}
      to="/tickets"
      linkText="My requests"
      testId="count-my-open"
    />
  );
}

/** A case worker's three cards (view=assigned); each opens the Work queue already filtered. */
function MyWork({ departmentId }) {
  const mine = { view: "assigned", departmentId };
  const open = useTicketList(ONE_ROW_OF({ ...mine, open: true }));
  const waiting = useTicketList(ONE_ROW_OF({ ...mine, waitingToStart: true }));
  const pending = useTicketList(
    ONE_ROW_OF({ ...mine, status: STATUS.Pending }),
  );
  const list = (filter) =>
    `/departments/${departmentId}/tickets?tab=assigned&${filter}`;
  return (
    <>
      <CountCard
        icon={UserCheck}
        title="Assigned to me"
        count={open.data?.total ?? null}
        to={list("status=open")}
        linkText="Work queue"
        testId="count-assigned"
      />
      <CountCard
        icon={Play}
        title="Waiting to start"
        count={waiting.data?.total ?? null}
        to={list("status=open&waiting=1")}
        linkText="Work queue"
        testId="count-waiting"
      />
      <CountCard
        icon={Hourglass}
        title="Pending"
        count={pending.data?.total ?? null}
        to={list(`status=${STATUS.Pending}`)}
        linkText="Work queue"
        testId="count-pending"
      />
    </>
  );
}

function NewInUnit({ department, unit }) {
  const list = useTicketList({
    view: "department",
    departmentId: department.id,
    unitId: unit.id,
    status: STATUS.New,
    page: 1,
    pageSize: 1,
  });
  return (
    <CountCard
      icon={Inbox}
      title={`New in ${unit.name}`}
      count={list.data?.total ?? null}
      to={`/departments/${department.id}/tickets`}
      linkText="Work queue"
      testId={`count-new-${unit.id}`}
    />
  );
}

export default function HomePage() {
  const { user } = useSession();
  const roles = sortRoles(user.roles);
  const { data: org } = useMyOrganisation();
  // A case worker is a member of a unit; their queue opens on "Assigned to me".
  const memberDepartment = org?.departments.find((department) =>
    department.units.some((unit) => unit.isMember),
  );
  const places = describePlaces(org);
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const { data: coverWarnings } = useCoverWarnings({ enabled: isSuperAdmin });

  return (
    <div className="space-y-6">
      <Card className="px-6 py-5">
        <h1 className="text-2xl font-semibold">Welcome, {firstNameOf(user)}</h1>
        <p className="mt-1 text-sm text-muted">
          {[user.department, user.jobTitle].filter(Boolean).join(" · ") ||
            "Access Pensions"}
        </p>
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
      </Card>

      <section aria-labelledby="home-requests">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="home-requests" className="text-base font-semibold">
            Requests
          </h2>
          <RaiseTicketLink />
        </div>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MyOpenRequests />
          {memberDepartment && <MyWork departmentId={memberDepartment.id} />}
          {(org?.departments ?? []).flatMap((department) =>
            department.units
              .filter((unit) => unit.isMember)
              .map((unit) => (
                <NewInUnit key={unit.id} department={department} unit={unit} />
              )),
          )}
        </ul>
      </section>

      {isSuperAdmin && coverWarnings?.length > 0 && (
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
      )}

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
