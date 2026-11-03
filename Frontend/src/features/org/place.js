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
      else if (unit.isDeputy) places.push(`${where} (Deputy Head of Unit)`);
      else if (unit.isMember) places.push(where);
    }
  }
  return places;
}

/** True when the person heads or deputises this unit. */
export function leadsUnit(org, unitId) {
  return Boolean(
    org?.departments?.some((department) =>
      department.units.some(
        (unit) => unit.id === unitId && (unit.isHead || unit.isDeputy),
      ),
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
