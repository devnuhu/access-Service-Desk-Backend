import { useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useSession } from "@/features/auth";
import {
  isDepartmentStaff,
  useMyOrganisation,
  useOrgDepartments,
} from "@/features/org";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { Card, Spinner } from "@/shared/ui";
import { STATUS_LABELS, TICKET_SORT } from "../api/endpoints.js";
import TicketTable from "../components/TicketTable.jsx";
import { PAGE_SIZE, useTicketList } from "../hooks/useTickets.js";

const OPEN = "open";
const ALL = "all";
const ASSIGNED = "assigned";
const UNIT = "unit";
const ADMIN = "admin";

const SORTS = [
  [TICKET_SORT.Newest, "Newest"],
  [TICKET_SORT.LongestWaiting, "Longest waiting since assigned"],
  [TICKET_SORT.RecentlyAssigned, "Most recently assigned"],
];

/**
 * A department's work queue (its staff and Super Admin).
 *
 * Unit members get tabs: "Assigned to me" (view=assigned; the default for a case worker), "All
 * open" for their own unit (the default for heads and deputies), and, for the department's Admin
 * (org/me isAdmin), "Admin": every ticket in the department, like the HOD. The HOD and a Super Admin
 * are not members and see the whole department with a unit filter.
 *
 * Filters go to the server (status or open=true, waitingToStart=true, sort) except "Escalated",
 * which keeps the escalated tickets of the page shown (escalatedToHeadAt). Home's cards open a
 * filtered list with ?tab=, ?status=, ?waiting=1 and ?sort=.
 */
export default function WorkQueuePage() {
  const { departmentId } = useParams();
  const { user } = useSession();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const org = useMyOrganisation();
  const allDepartments = useOrgDepartments({ enabled: isSuperAdmin });

  if (org.isLoading || (isSuperAdmin && allDepartments.isLoading)) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!isSuperAdmin && !isDepartmentStaff(org.data, departmentId)) {
    return <Navigate to="/no-access" replace />;
  }

  const mine = org.data?.departments.find((d) => d.id === departmentId);
  const listed = allDepartments.data?.find((d) => d.id === departmentId);
  const department = mine ?? listed;
  const ownUnit = mine?.units.find((unit) => unit.isMember);
  return (
    <WorkQueue
      key={departmentId}
      departmentId={departmentId}
      name={department?.name ?? "Department"}
      units={(listed ?? mine)?.units ?? []}
      ownUnit={ownUnit ?? null}
      isAdmin={Boolean(mine?.isAdmin)}
      startAssigned={
        Boolean(ownUnit) &&
        !ownUnit.isHead &&
        !ownUnit.isDeputy &&
        !isSuperAdmin
      }
    />
  );
}

function firstTab(asked, tabs, startAssigned) {
  const ids = tabs.map(([id]) => id);
  const wanted = asked === "department" ? UNIT : asked;
  if (ids.includes(wanted)) return wanted;
  return startAssigned ? ASSIGNED : (ids.find((id) => id !== ASSIGNED) ?? null);
}

function WorkQueue({
  departmentId,
  name,
  units,
  ownUnit,
  isAdmin,
  startAssigned,
}) {
  const tabs = ownUnit
    ? [
        [ASSIGNED, "Assigned to me"],
        [UNIT, "All open"],
        ...(isAdmin ? [[ADMIN, "Admin"]] : []),
      ]
    : [];
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() =>
    firstTab(searchParams.get("tab"), tabs, startAssigned),
  );
  const assigned = tab === ASSIGNED;
  // Department-wide: the HOD and Super Admin (no tabs) and the Admin tab.
  const wide = tab === null || tab === ADMIN;
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") ?? OPEN);
  const [waiting, setWaiting] = useState(searchParams.get("waiting") === "1");
  const [escalated, setEscalated] = useState(false);
  const [sortChoice, setSortChoice] = useState(searchParams.get("sort"));
  const sort =
    sortChoice ?? (assigned ? TICKET_SORT.LongestWaiting : TICKET_SORT.Newest);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const key = `${tab}|${unitId}|${status}|${waiting}|${sort}|${search}`;
  const page = pageState.key === key ? pageState.page : 1;
  const setPage = (next) => setPageState({ page: next, key });

  const base = assigned
    ? { view: "assigned", departmentId }
    : {
        view: "department",
        departmentId,
        unitId: wide ? unitId || undefined : ownUnit.id,
      };
  const list = useTicketList({
    ...base,
    search,
    open: status === OPEN ? true : undefined,
    status: status === OPEN || status === ALL ? undefined : Number(status),
    waitingToStart: waiting || undefined,
    sort: sort === TICKET_SORT.Newest ? undefined : sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageItems = list.data?.items ?? [];
  const items = escalated
    ? pageItems.filter((ticket) => ticket.escalatedToHeadAt)
    : pageItems;
  const total = list.data?.total ?? 0;
  const filtered = Boolean(search) || status !== OPEN || waiting || escalated;

  const chip = (pressed, onClick, label) => (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-sm font-semibold ${pressed ? "border-brand-navy bg-brand-navy text-white" : "border-line bg-white text-body hover:border-brand-navy"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{name}: work queue</h1>
        <p className="mt-1 text-sm text-muted">
          {wide || assigned
            ? `Tickets raised to ${name}.`
            : `Tickets of ${ownUnit.name}.`}
        </p>
      </div>

      <Card>
        {tabs.length > 0 && (
          <div
            role="tablist"
            aria-label="Which tickets"
            className="flex gap-1 border-b border-line px-3 pt-2"
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setSortChoice(null);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3 px-5 pt-3">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              aria-label="Search by reference, subject or description"
              placeholder="Reference, subject or description"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="h-10 w-full rounded-[6px] border border-line pr-3 pl-9 text-sm text-ink"
            />
          </div>
          {wide && (
            <select
              aria-label="Unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              className="h-10 rounded-[6px] border border-line bg-white px-3 text-sm text-ink"
            >
              <option value="">All units</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-[6px] border border-line bg-white px-3 text-sm text-ink"
          >
            <option value={OPEN}>Open</option>
            <option value={ALL}>All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort"
            value={sort}
            onChange={(event) => setSortChoice(event.target.value)}
            className="h-10 rounded-[6px] border border-line bg-white px-3 text-sm text-ink"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {chip(waiting, () => setWaiting((on) => !on), "Waiting to start")}
          {chip(escalated, () => setEscalated((on) => !on), "Escalated")}
          {escalated && (
            <span className="text-xs text-muted">
              Escalated keeps the escalated tickets of this page.
            </span>
          )}
        </div>

        <TicketTable
          queue
          items={items}
          isLoading={list.isLoading}
          error={list.error}
          dimmed={list.isPlaceholderData}
          total={total}
          page={page}
          pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          onPage={setPage}
          empty={
            <p className="px-5 py-10 text-center text-sm text-muted">
              {filtered
                ? "No tickets match these filters."
                : assigned
                  ? "Nothing assigned to you is open."
                  : "No open tickets. New requests show here as they arrive."}
            </p>
          }
        />
      </Card>
    </div>
  );
}
