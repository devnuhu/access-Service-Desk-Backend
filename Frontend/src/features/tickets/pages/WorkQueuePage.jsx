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
import { parseUtc } from "@/shared/lib/time";
import { Card, PageHeader, Spinner, UnitEyebrow } from "@/shared/ui";
import { STATUS, STATUS_LABELS, TICKET_SORT } from "../api/endpoints.js";
import BulkActions from "../components/BulkActions.jsx";
import PoolTable from "../components/PoolTable.jsx";
import SlaSummary from "../components/SlaSummary.jsx";
import TicketTable from "../components/TicketTable.jsx";
import ViewsMenu from "../components/ViewsMenu.jsx";
import {
  PAGE_SIZE,
  usePool,
  useSlaSummary,
  useTicketList,
} from "../hooks/useTickets.js";
import { BUILT_IN_VIEWS, filterKey, fromFilter, toFilter } from "../views.js";

const OPEN = "open";
const ALL = "all";
const ASSIGNED = "assigned";
const UNIT = "unit";
const ADMIN = "admin";
const POOL = "pool";

/** Browser-only: the API has no sort=due, so this orders the page shown (fetched newest first). */
const DUE_SOONEST = "due";

const SORTS = [
  [TICKET_SORT.Newest, "Newest"],
  [TICKET_SORT.LongestWaiting, "Longest waiting since assigned"],
  [TICKET_SORT.RecentlyAssigned, "Most recently assigned"],
  [DUE_SOONEST, "Due soonest"],
];

/** Earliest slaDueAt first; tickets without one keep their order at the end. */
function byDueSoonest(items) {
  const due = (ticket) => parseUtc(ticket.slaDueAt)?.getTime() ?? Infinity;
  return items
    .map((ticket, index) => [due(ticket), index, ticket])
    .sort(([a, i], [b, j]) => (a === b ? i - j : a < b ? -1 : 1))
    .map(([, , ticket]) => ticket);
}

/**
 * A department's work queue (its staff and Super Admin).
 *
 * Unit members get tabs: "Assigned to me" (view=assigned; the default for a case worker), "All
 * open" for their own unit (the default for unit heads), "Unit pool" (New tickets they may pick,
 * with a count; GET /api/pool, polled every 60 s), and, for the department's Admin
 * (org/me isAdmin), "Admin": every ticket in the department, like the HOD. The HOD and a Super Admin
 * are not members and see the whole department with a unit filter.
 *
 * Filters go to the server (status or open=true, waitingToStart=true, slaBreached=true,
 * escalated=true, sort) except the "Due soonest" sort, which orders the page shown by slaDueAt
 * (the API has no sort=due). "Views" applies a built-in or saved set of filters (../views.js);
 * ticked rows get the bulk actions that fit the tab (Pick, Start work, Resolve, Reassign).
 * Home's cards open a filtered list with ?tab=, ?status=, ?waiting=1, ?overdue=1, ?escalated=1, ?sort= and
 * ?unit= (the unit filter of a department-wide view; a Department Admin asking for a unit that is
 * not their own opens the Admin tab).
 * Unit heads (All open), the Admin tab, the HOD and a Super Admin also get the SLA counts;
 * Overdue applies slaBreached, Unassigned shows New tickets (nobody holds a ticket until it leaves New).
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
      startAssigned={Boolean(ownUnit) && !ownUnit.isHead && !isSuperAdmin}
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
        [POOL, "Unit pool"],
        ...(isAdmin ? [[ADMIN, "Admin"]] : []),
      ]
    : [];
  // The unit pool is for unit members and heads (ownUnit); only this department's units here.
  const pool = usePool({ enabled: Boolean(ownUnit) });
  const unitIds = new Set(units.map((unit) => unit.id));
  const poolHere = {
    ...pool,
    data: pool.data?.filter((ticket) => unitIds.has(ticket.unitId)),
  };
  const poolCount = poolHere.data?.length ?? 0;
  const [searchParams] = useSearchParams();
  const askedUnit = searchParams.get("unit") ?? "";
  const [tab, setTab] = useState(() =>
    isAdmin && askedUnit && askedUnit !== ownUnit?.id
      ? ADMIN
      : firstTab(searchParams.get("tab"), tabs, startAssigned),
  );
  const assigned = tab === ASSIGNED;
  // A case worker or head works in one unit here: the page is that unit's (the Department Admin
  // oversees the department, so their page stays the department's).
  const member = Boolean(ownUnit) && !isAdmin;
  const pooled = tab === POOL;
  // Department-wide: the HOD and Super Admin (no tabs) and the Admin tab.
  const wide = tab === null || tab === ADMIN;
  const [unitId, setUnitId] = useState(askedUnit);
  const [status, setStatus] = useState(searchParams.get("status") ?? OPEN);
  const [waiting, setWaiting] = useState(searchParams.get("waiting") === "1");
  const [breached, setBreached] = useState(searchParams.get("overdue") === "1");
  const [escalated, setEscalated] = useState(
    searchParams.get("escalated") === "1",
  );
  const [sortChoice, setSortChoice] = useState(searchParams.get("sort"));
  const sort =
    sortChoice ?? (assigned ? TICKET_SORT.LongestWaiting : TICKET_SORT.Newest);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const filtersKey = `${tab}|${unitId}|${status}|${waiting}|${breached}|${escalated}|${sort}|${search}`;
  const key = filtersKey;
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
    slaBreached: breached || undefined,
    escalated: escalated || undefined,
    sort:
      sort === TICKET_SORT.Newest || sort === DUE_SOONEST ? undefined : sort,
    page,
    pageSize: PAGE_SIZE,
  });

  // Oversight counts: a head for their unit on "All open"; the Admin tab, the HOD and a
  // Super Admin for the whole department.
  const leadsUnit = Boolean(ownUnit?.isHead);
  const showSummary = wide || (tab === UNIT && leadsUnit);
  const summary = useSlaSummary(departmentId, wide ? undefined : ownUnit?.id, {
    enabled: showSummary,
  });

  const pageItems = list.data?.items ?? [];
  const items = sort === DUE_SOONEST ? byDueSoonest(pageItems) : pageItems;

  // Views: the filters as one object (../views.js), and which view shows now.
  const tabName = {
    [ASSIGNED]: "assigned",
    [UNIT]: "unit",
    [POOL]: "pool",
    [ADMIN]: "admin",
  };
  const currentFilter = toFilter({
    tab: tabName[tab] ?? "unit",
    unitId: wide ? unitId : "",
    status,
    waiting,
    breached,
    escalated,
    search: text.trim(),
    sort: sortChoice,
  });
  const currentKey = filterKey(currentFilter);
  const builtIns = BUILT_IN_VIEWS.filter((view) => !view.needsUnit || ownUnit);
  const sameAs = (filter) =>
    filterKey(toFilter(fromFilter(filter))) === currentKey;
  const applyView = (filter) => {
    const next = fromFilter(filter);
    const wanted =
      { assigned: ASSIGNED, pool: POOL, admin: ADMIN, unit: UNIT }[next.tab] ??
      UNIT;
    const ids = tabs.map(([id]) => id);
    setTab(
      ids.length === 0
        ? null
        : ids.includes(wanted)
          ? wanted
          : ids.includes(UNIT)
            ? UNIT
            : ids[0],
    );
    setUnitId(next.unitId);
    setStatus(next.status);
    setWaiting(next.waiting);
    setBreached(next.breached);
    setEscalated(next.escalated);
    setText(next.search);
    setSortChoice(next.sort);
  };

  // Ticked rows: kept while the tab and filters stay the same (across pages), cleared otherwise.
  const [selection, setSelection] = useState({ key: "", rows: new Map() });
  const rows = selection.key === filtersKey ? selection.rows : new Map();
  const canReassign = leadsUnit || wide;
  const selectable = pooled || assigned || canReassign;
  const select = (list, on) =>
    setSelection(() => {
      const next = new Map(rows);
      for (const ticket of list) {
        if (on) next.set(ticket.id, ticket);
        else next.delete(ticket.id);
      }
      return { key: filtersKey, rows: next };
    });
  const clearSelection = () => setSelection({ key: "", rows: new Map() });
  const selectedIds = new Set(rows.keys());
  const total = list.data?.total ?? 0;
  const filtered =
    Boolean(search) || status !== OPEN || waiting || breached || escalated;
  const unassignedOnly = status === String(STATUS.New);

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
      {member ? (
        <PageHeader
          title={`${ownUnit.name} work queue`}
          eyebrow={
            <UnitEyebrow unitName={ownUnit.name} departmentName={name} />
          }
          description={`Tickets for ${ownUnit.name}.`}
        />
      ) : (
        <PageHeader
          title="Work queue"
          eyebrow={name}
          description={`Tickets raised to ${name}.`}
        />
      )}

      {showSummary && (
        <SlaSummary
          query={summary}
          overdueOn={breached}
          unassignedOn={unassignedOnly}
          onOverdue={() => setBreached((on) => !on)}
          onUnassigned={() =>
            setStatus((current) =>
              current === String(STATUS.New) ? OPEN : String(STATUS.New),
            )
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ViewsMenu
          builtIns={builtIns}
          filterJson={JSON.stringify(currentFilter)}
          matches={sameAs}
          onApply={applyView}
        />
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
                  clearSelection();
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
              >
                {label}
                {id === POOL && poolCount > 0 && (
                  <span
                    className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[11px] leading-5 font-bold text-ink"
                    data-testid="pool-count"
                  >
                    {poolCount}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {selectable && (
          <BulkActions
            tickets={[...rows.values()]}
            pool={pooled}
            mine={assigned}
            canReassign={canReassign}
            onClear={clearSelection}
            onDone={clearSelection}
          />
        )}
        {pooled ? (
          <PoolTable
            pool={poolHere}
            showUnit={new Set(poolHere.data?.map((t) => t.unitId)).size > 1}
            selected={selectedIds}
            onSelect={(ticket, on) => select([ticket], on)}
            onSelectAll={(on) => select(poolHere.data ?? [], on)}
          />
        ) : (
          <>
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
                  className="h-10 w-full rounded-lg border border-line pr-3 pl-9 text-sm text-ink"
                />
              </div>
              {wide && (
                <select
                  aria-label="Unit"
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
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
                className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
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
                className="h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
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
              {chip(breached, () => setBreached((on) => !on), "Overdue")}
              {chip(escalated, () => setEscalated((on) => !on), "Escalated")}
              {sort === DUE_SOONEST && (
                <span className="text-xs text-muted">
                  Due soonest orders the tickets of this page.
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
              selected={selectable ? selectedIds : undefined}
              onSelect={(ticket, on) => select([ticket], on)}
              onSelectAll={(on) => select(items, on)}
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
          </>
        )}
      </Card>
    </div>
  );
}
