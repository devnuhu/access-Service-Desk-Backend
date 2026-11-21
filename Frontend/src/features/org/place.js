/**
 * Plain-language places from GET /api/org/me, for Home:
 * "Contribution Matching · Contribution Processing (Head of Unit)".
 * @param {{ departments: any[] } | undefined} org
 * @returns {string[]}
 */
export function describePlaces(org) {
  const places = [];
  for (const department of org?.departments ?? []) {
    if (department.isHod)
      places.push(`${department.name} (Head of Department)`);
    for (const unit of department.units) {
      const where = `${unit.name} · ${department.name}`;
      if (unit.isHead) places.push(`${where} (Head of Unit)`);
      else if (unit.isMember) places.push(where);
    }
  }
  return places;
}

/** True when the person heads this unit. */
export function leadsUnit(org, unitId) {
  return Boolean(
    org?.departments?.some((department) =>
      department.units.some((unit) => unit.id === unitId && unit.isHead),
    ),
  );
}

/** True when the person is the HOD of this department. */
export function isHodOf(org, departmentId) {
  return Boolean(
    org?.departments?.some(
      (department) => department.id === departmentId && department.isHod,
    ),
  );
}

/** Staff of a department: a member of one of its units, or its HOD (they see its tickets). */
export function isDepartmentStaff(org, departmentId) {
  return Boolean(
    org?.departments?.some(
      (department) =>
        department.id === departmentId &&
        (department.isHod || department.units.some((unit) => unit.isMember)),
    ),
  );
}

/** The units this person heads (org/me). */
export function headedUnits(org) {
  return (org?.departments ?? []).flatMap((department) =>
    department.units.filter((unit) => unit.isHead),
  );
}

/** Oversees whole departments: an HOD or Department Admin in org/me, or a Super Admin. */
export function oversees(org, isSuperAdmin = false) {
  return (
    isSuperAdmin ||
    Boolean(
      org?.departments?.some(
        (department) => department.isHod || department.isAdmin,
      ),
    )
  );
}

/** The units this person works in (org/me), with their department's id and name. */
export function memberUnits(org) {
  return (org?.departments ?? []).flatMap((department) =>
    department.units
      .filter((unit) => unit.isMember)
      .map((unit) => ({
        ...unit,
        departmentId: department.id,
        departmentName: department.name,
      })),
  );
}

/**
 * Where a unit sits, from org/me: { unitName, departmentName }, or null when org/me does not list
 * it. `departmentId` finds the department alone (an HOD sees its units elsewhere).
 */
export function unitPlace(org, unitId, departmentId) {
  for (const department of org?.departments ?? []) {
    const unit = department.units.find((u) => u.id === unitId);
    if (unit) return { unitName: unit.name, departmentName: department.name };
    if (departmentId && department.id === departmentId)
      return { unitName: null, departmentName: department.name };
  }
  return null;
}
