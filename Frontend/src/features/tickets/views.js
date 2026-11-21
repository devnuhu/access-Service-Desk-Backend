import { STATUS } from "./api/endpoints.js";

/**
 * A saved view's filterJson: the Work queue's filters as one object (the list query as the page
 * sends it, plus the tab it was on). Unknown keys are ignored when a view is applied.
 *
 * {
 *   tab: "assigned" | "unit" | "pool" | "admin",   // "unit" is the department view for the HOD
 *   unitId?: string,          // the unit filter of a department-wide view
 *   open?: true,              // open tickets (otherwise status, or every status)
 *   status?: number,          // STATUS
 *   waitingToStart?: true, slaBreached?: true, escalated?: true,
 *   search?: string,
 *   sort?: string,            // TICKET_SORT, or "due" (due soonest)
 * }
 */

export const OPEN = "open";
export const ALL = "all";

/** The page's filter state -> the object stored in filterJson. */
export function toFilter({
  tab,
  unitId,
  status,
  waiting,
  breached,
  escalated,
  search,
  sort,
}) {
  const filter = { tab: tab ?? "unit" };
  if (unitId) filter.unitId = unitId;
  if (status === OPEN) filter.open = true;
  else if (status !== ALL) filter.status = Number(status);
  if (waiting) filter.waitingToStart = true;
  if (breached) filter.slaBreached = true;
  if (escalated) filter.escalated = true;
  if (search) filter.search = search;
  if (sort) filter.sort = sort;
  return filter;
}

/** filterJson -> the page's filter state. Anything unreadable gives the plain open list. */
export function fromFilter(json) {
  let filter = {};
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      filter = parsed;
  } catch {
    filter = {};
  }
  // A status wins; open=true is the open list; neither is every status (as toFilter writes it).
  const status = Number.isInteger(filter.status)
    ? String(filter.status)
    : filter.open === true
      ? OPEN
      : ALL;
  return {
    tab: typeof filter.tab === "string" ? filter.tab : "unit",
    unitId: typeof filter.unitId === "string" ? filter.unitId : "",
    status,
    waiting: filter.waitingToStart === true,
    breached: filter.slaBreached === true,
    escalated: filter.escalated === true,
    search: typeof filter.search === "string" ? filter.search : "",
    sort: typeof filter.sort === "string" ? filter.sort : null,
  };
}

/** The same filters, compared as text (to tell which view is showing). */
export const filterKey = (filter) =>
  JSON.stringify(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Built-in views, defined here (not stored). `needsUnit`: only for someone who works in a unit of
 * the department (the tabs Assigned to me and Unit pool).
 */
export const BUILT_IN_VIEWS = [
  {
    id: "my-open",
    name: "My open",
    filter: { tab: "assigned", open: true },
    needsUnit: true,
  },
  { id: "pool", name: "Unit pool", filter: { tab: "pool" }, needsUnit: true },
  {
    id: "all-open",
    name: "All open (unit)",
    filter: { tab: "unit", open: true },
  },
  {
    id: "unassigned",
    name: "Unassigned",
    filter: { tab: "unit", status: STATUS.New },
  },
  {
    id: "overdue",
    name: "Overdue",
    filter: { tab: "unit", open: true, slaBreached: true },
  },
  {
    id: "escalated",
    name: "Escalated",
    filter: { tab: "unit", open: true, escalated: true },
  },
  {
    id: "pending",
    name: "Waiting on requester",
    filter: { tab: "unit", status: STATUS.Pending },
  },
  {
    id: "resolved",
    name: "Awaiting confirmation",
    filter: { tab: "unit", status: STATUS.Resolved },
  },
];
