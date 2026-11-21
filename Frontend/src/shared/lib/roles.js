/** Role names as seeded by the API (Domain/AppRoles.cs) and how the UI shows them. */
export const ROLES = Object.freeze({
  Requester: "Requester",
  CaseWorker: "CaseWorker",
  HeadOfUnit: "HeadOfUnit",
  HOD: "HOD",
  SuperAdmin: "SuperAdmin",
  DepartmentAdmin: "DepartmentAdmin",
});

export const ROLE_ORDER = [
  ROLES.Requester,
  ROLES.CaseWorker,
  ROLES.HeadOfUnit,
  ROLES.HOD,
  ROLES.DepartmentAdmin,
  ROLES.SuperAdmin,
];

/**
 * Structure roles follow the organisation (rule 15): a unit member is a Case Worker, the head of an
 * active unit is a Head of Unit, a department's HOD is HOD, its Department Admin (named on the Units
 * page) is Department Admin. They are never given or taken on the People page.
 */
export const STRUCTURE_ROLES = [
  ROLES.CaseWorker,
  ROLES.HeadOfUnit,
  ROLES.HOD,
  ROLES.DepartmentAdmin,
];

/** The only role the People page gives by hand. Requester is everyone's. */
export const ASSIGNABLE_ROLES = [ROLES.SuperAdmin];

/**
 * Who may use Reports (Step 9): the service allows unit heads, HODs, Department Admins and Super
 * Admin; anyone else gets 403.
 */
export const REPORT_ROLES = [
  ROLES.HeadOfUnit,
  ROLES.HOD,
  ROLES.DepartmentAdmin,
  ROLES.SuperAdmin,
];

export function isStructureRole(role) {
  return STRUCTURE_ROLES.includes(role);
}

const LABELS = {
  Requester: "Requester",
  CaseWorker: "Case Worker",
  HeadOfUnit: "Head of Unit",
  HOD: "Head of Department",
  DepartmentAdmin: "Department Admin",
  SuperAdmin: "Super Admin",
};

/** "HeadOfUnit" -> "Head of Unit". Unknown names are shown as they come. */
export function roleLabel(role) {
  return LABELS[role] ?? role;
}

/** Roles in a fixed order (Requester first), unknown names last. */
export function sortRoles(roles = []) {
  const rank = (role) => {
    const index = ROLE_ORDER.indexOf(role);
    return index < 0 ? ROLE_ORDER.length : index;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b));
}

/** True when the user holds at least one of the roles. */
export function hasAnyRole(user, roles) {
  return Boolean(user?.roles?.some((role) => roles.includes(role)));
}
