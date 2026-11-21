/**
 * The SaveReportRequest body (POST and PUT /api/reports/saved) from form values or a saved report:
 * only the share field that goes with the choice is sent. The title follows the name, so the
 * download and the email carry it.
 */
export function savedReportBody({
  name,
  description,
  definition,
  share,
  shareUnitId,
  shareDepartmentId,
  shareRoles,
}) {
  return {
    name,
    description: description?.trim() || undefined,
    definition: { ...definition, title: name.trim() },
    share,
    ...(share === "unit" && { shareUnitId: shareUnitId || undefined }),
    ...(share === "department" && {
      shareDepartmentId: shareDepartmentId || undefined,
    }),
    ...(share === "roles" && { shareRoles: shareRoles ?? [] }),
  };
}

/** True for a 404: the saved report is gone or no longer shared with this person. */
export const isGone = (error) => error?.status === 404;
