import { Navigate, Outlet, useParams } from "react-router-dom";
import { useSession } from "@/features/auth";
import {
  isHodOf,
  leadsUnit,
  useMyOrganisation,
  useOrgDepartments,
} from "@/features/org";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { Spinner } from "@/shared/ui";

/**
 * Guards the team availability pages with the organisation data: the head of the unit,
 * the HOD of its department, or a Super Admin. Everyone else gets the no-access page. The server
 * still decides (rule 2); a 403 from it is shown on the page.
 */
export default function RequireTeamAccess() {
  const { unitId, departmentId } = useParams();
  const { user } = useSession();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const org = useMyOrganisation({ enabled: !isSuperAdmin });
  // An HOD may open any unit of their department; org/me lists only their own units, so the unit's
  // department comes from the list of departments.
  const needsDepartments =
    !isSuperAdmin &&
    Boolean(unitId) &&
    org.isSuccess &&
    !leadsUnit(org.data, unitId);
  const departments = useOrgDepartments({ enabled: needsDepartments });

  if (isSuperAdmin) return <Outlet />;
  if (org.isLoading || (needsDepartments && departments.isLoading)) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }

  let allowed;
  if (unitId) {
    const departmentOfUnit = departments.data?.find((d) =>
      d.units.some((u) => u.id === unitId),
    );
    allowed =
      leadsUnit(org.data, unitId) ||
      (departmentOfUnit && isHodOf(org.data, departmentOfUnit.id));
  } else {
    allowed = isHodOf(org.data, departmentId);
  }
  return allowed ? <Outlet /> : <Navigate to="/no-access" replace />;
}
