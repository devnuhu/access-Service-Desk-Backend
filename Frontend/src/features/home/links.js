/**
 * A unit's list in its department's Work queue: the head lands on their unit's "All open" tab
 * (tab=department), the HOD and Super Admin on the department view filtered to the unit.
 * `filter` is extra query text ("&overdue=1"); `tab` picks another tab ("pool").
 */
export function unitQueue(
  { departmentId, unitId },
  filter = "",
  tab = "department",
) {
  return `/departments/${departmentId}/tickets?tab=${tab}&unit=${unitId}${filter}`;
}

/** Where a unit's dashboard lives (the HOD overview's rows open it). */
export const unitDashboardPath = (unitId) => `/dashboard/unit/${unitId}`;
