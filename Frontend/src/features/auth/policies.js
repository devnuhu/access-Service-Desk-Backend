/**
 * Authorization policies copied from ServiceDeskAPI Infrastructure/Identity/Policies.cs (role
 * names from Domain/AppRoles.cs). The UI uses them only to choose what to show; the server decides.
 * SuperAdmin passes every policy. HOD oversees but does not work tickets, so HOD is not in Case_Work.
 */
export const POLICIES = Object.freeze({
  Super_Admin_Only: ["SuperAdmin"],
  Unit_Management: ["HeadOfUnit", "SuperAdmin"],
  Department_Oversight: ["HOD", "SuperAdmin"],
  Oversight: ["HeadOfUnit", "HOD", "SuperAdmin"],
  Case_Work: ["CaseWorker", "HeadOfUnit", "SuperAdmin"],
});

/**
 * @param {{ roles?: string[] } | null | undefined} user
 * @param {keyof typeof POLICIES} policy
 */
export function hasPolicy(user, policy) {
  const roles = POLICIES[policy];
  if (!roles) throw new Error(`Unknown policy "${policy}".`);
  return Boolean(user?.roles?.some((role) => roles.includes(role)));
}
