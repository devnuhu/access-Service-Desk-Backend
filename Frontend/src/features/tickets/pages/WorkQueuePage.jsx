import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
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
import { STATUS_LABELS } from "../api/endpoints.js";
import TicketTable from "../components/TicketTable.jsx";
import {
  OPEN_PAGE_SIZE,
  PAGE_SIZE,
  useOpenTickets,
  useTicketList,
} from "../hooks/useTickets.js";

const OPEN = "open";
const ALL = "all";

/**
 * A department's work queue (its staff and Super Admin). Status "Open" (the default) is New,
 * Assigned, In progress, Pending and Reopened: the API filters one status at a time, so the page
 * asks once per open status (newest 100 each), merges them and pages in the browser. Any other
 * choice is filtered and paged by the server.
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
  return (
    <WorkQueue
      key={departmentId}
      departmentId={departmentId}
      name={department?.name ?? "Department"}
      units={(listed ?? mine)?.units ?? []}
      ownUnitId={mine?.units.find((unit) => unit.isMember)?.id ?? ""}
    />
  );
}

function WorkQueue({ departmentId, name, units, ownUnitId }) {
  const [unitId, setUnitId] = useState(ownUnitId);
  const [status, setStatus] = useState(OPEN);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 300);
  const [pageState, setPageState] = useState({ page: 1, key: "" });
  const key = `${unitId}|${status}|${search}`;
  const page = pageState.key === key ? pageState.page : 1;
  const setPage = (next) => setPageState({ page: next, key });

  const base = {
    view: "department",
    departmentId,
    unitId: unitId || undefined,
    search,
  };
  const showOpen = status === OPEN;
  const open = useOpenTickets(base, { enabled: showOpen });
  const list = useTicketList(
    {
      ...base,
      status: status === ALL ? undefined : Number(status),
      page,
      pageSize: PAGE_SIZE,
    },
    { enabled: !showOpen },
  );

  const total = showOpen ? open.items.length : (list.data?.total ?? 0);
  const items = showOpen
    ? open.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : (list.data?.items ?? []);
  const filtered = Boolean(search) || status !== OPEN;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{name}: work queue</h1>
        <p className="mt-1 text-sm text-muted">
          Tickets raised to {name}. Assignment and status actions arrive in the
          next release.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line px-5 py-3">
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
        </div>
        {showOpen && open.truncated && (
          <p className="border-b border-line bg-brand-orange-light px-5 py-2 text-xs text-brand-orange-ink">
            Showing the newest {OPEN_PAGE_SIZE} tickets of each open status.
            Search or choose a status to see the rest.
          </p>
        )}

        <TicketTable
          queue
          items={items}
          isLoading={showOpen ? open.isLoading : list.isLoading}
          error={showOpen ? open.error : list.error}
          dimmed={!showOpen && list.isPlaceholderData}
          total={total}
          page={page}
          pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          onPage={setPage}
          empty={
            <p className="px-5 py-10 text-center text-sm text-muted">
              {filtered
                ? "No tickets match these filters."
                : "No open tickets. New requests show here as they arrive."}
            </p>
          }
        />
      </Card>
    </div>
  );
}
