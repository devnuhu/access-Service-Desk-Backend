import { useId, useRef, useState } from "react";
import { useMyOrganisation, useOrgDepartments } from "@/features/org";
import { Button, Dialog } from "@/shared/ui";
import { roleLabel } from "@/shared/lib/roles";
import { saveReportBody, SHARE_ROLES } from "../api/endpoints.js";
import {
  useCreateSavedReport,
  useRefreshSavedReports,
  useUpdateSavedReport,
} from "../hooks/useReports.js";
import { isGone, savedReportBody } from "../savedReport.js";

const inputClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink";

/**
 * Where a report can be shared: the departments and units you work in, head or run (a Super Admin:
 * every active one). The server checks it again.
 */
function useShareTargets(isSuperAdmin) {
  const mine = useMyOrganisation();
  const all = useOrgDepartments({ enabled: isSuperAdmin });
  const departments = isSuperAdmin
    ? (all.data ?? [])
    : (mine.data?.departments ?? []);
  return {
    departments: departments.map((d) => ({ id: d.id, name: d.name ?? "" })),
    units: departments.flatMap((d) =>
      (d.units ?? []).map((u) => ({
        id: u.id,
        name: departments.length > 1 ? `${u.name} (${d.name})` : u.name,
      })),
    ),
  };
}

/**
 * "Save as my report" (a new saved report from `definition`), or Edit (`report`: name,
 * description and who can see it; its definition is kept). Whoever opens a shared report sees
 * only what they are allowed to see. `thenEmail` changes the button to "Save and set up email".
 */
export default function SaveReportDialog({
  report,
  definition,
  defaultName = "",
  defaultDescription = "",
  thenEmail = false,
  isSuperAdmin = false,
  onClose,
  onSaved,
}) {
  const editing = Boolean(report);
  const ids = {
    name: useId(),
    description: useId(),
    unit: useId(),
    department: useId(),
  };
  const nameRef = useRef(null);
  const targets = useShareTargets(isSuperAdmin);
  const create = useCreateSavedReport();
  const update = useUpdateSavedReport();
  const refreshSaved = useRefreshSavedReports();
  const busy = create.isPending || update.isPending;
  const [values, setValues] = useState(() => ({
    name: report?.name ?? defaultName,
    description: report?.description ?? defaultDescription ?? "",
    share: report?.share ?? "private",
    shareUnitId: report?.shareUnitId ?? "",
    shareDepartmentId: report?.shareDepartmentId ?? "",
    shareRoles: report?.shareRoles ?? [],
  }));
  const [errors, setErrors] = useState({});

  const set = (name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors({});
  };

  // "My unit" / "My department": the only one there is is chosen for you.
  const chooseShare = (share) => {
    setValues((current) => ({
      ...current,
      share,
      shareUnitId:
        current.shareUnitId ||
        (targets.units.length === 1 ? targets.units[0].id : ""),
      shareDepartmentId:
        current.shareDepartmentId ||
        (targets.departments.length === 1 ? targets.departments[0].id : ""),
    }));
    setErrors({});
  };

  const toggleRole = (role) =>
    set(
      "shareRoles",
      values.shareRoles.includes(role)
        ? values.shareRoles.filter((r) => r !== role)
        : [...values.shareRoles, role],
    );

  const save = async (event) => {
    event.preventDefault();
    const body = savedReportBody({
      ...values,
      definition: editing ? (report.definition ?? {}) : definition,
    });
    const checked = saveReportBody.safeParse(body);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(
          checked.error.issues.map((issue) => [issue.path[0], issue.message]),
        ),
      );
      return;
    }
    try {
      onSaved(
        editing
          ? await update.mutateAsync({ id: report.id, body })
          : await create.mutateAsync(body),
      );
    } catch (failure) {
      if (isGone(failure)) refreshSaved();
      setErrors({ form: failure.message });
    }
  };

  const shareChoices = [
    ["private", "Only me"],
    ...(targets.units.length ? [["unit", "My unit"]] : []),
    ...(targets.departments.length ? [["department", "My department"]] : []),
    ["roles", "Selected roles"],
  ];

  const fieldError = (name) =>
    errors[name] && (
      <p className="mt-1 text-xs font-medium text-danger">{errors[name]}</p>
    );

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={editing ? `Edit ${report.name}` : "Save as my report"}
      description="Whoever can see it sees only what they are allowed to see."
      initialFocusRef={nameRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="save-report-form" busy={busy}>
            {editing
              ? "Save changes"
              : thenEmail
                ? "Save and set up email"
                : "Save report"}
          </Button>
        </>
      }
    >
      <form
        id="save-report-form"
        onSubmit={save}
        noValidate
        className="space-y-4"
      >
        <div>
          <label htmlFor={ids.name} className="block text-sm font-semibold">
            Name
          </label>
          <input
            ref={nameRef}
            id={ids.name}
            value={values.name}
            maxLength={150}
            onChange={(event) => set("name", event.target.value)}
            aria-invalid={errors.name ? "true" : undefined}
            className={inputClass}
          />
          {fieldError("name")}
        </div>
        <div>
          <label
            htmlFor={ids.description}
            className="block text-sm font-semibold"
          >
            Description (optional)
          </label>
          <textarea
            id={ids.description}
            value={values.description}
            maxLength={500}
            rows={2}
            onChange={(event) => set("description", event.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
          />
          {fieldError("description")}
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Who can see it</legend>
          <div className="mt-1 space-y-1.5">
            {shareChoices.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="report-share"
                  value={value}
                  checked={values.share === value}
                  onChange={() => chooseShare(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {values.share === "unit" && targets.units.length > 1 && (
          <div>
            <label htmlFor={ids.unit} className="block text-sm font-semibold">
              Unit
            </label>
            <select
              id={ids.unit}
              value={values.shareUnitId}
              onChange={(event) => set("shareUnitId", event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a unit</option>
              {targets.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {values.share === "unit" && fieldError("shareUnitId")}
        {values.share === "department" && targets.departments.length > 1 && (
          <div>
            <label
              htmlFor={ids.department}
              className="block text-sm font-semibold"
            >
              Department
            </label>
            <select
              id={ids.department}
              value={values.shareDepartmentId}
              onChange={(event) => set("shareDepartmentId", event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a department</option>
              {targets.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {values.share === "department" && fieldError("shareDepartmentId")}
        {values.share === "roles" && (
          <fieldset>
            <legend className="text-sm font-semibold">Roles</legend>
            <div className="mt-1 space-y-1.5">
              {SHARE_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.shareRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {roleLabel(role)}
                </label>
              ))}
            </div>
            {fieldError("shareRoles")}
          </fieldset>
        )}

        {errors.form && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.form}
          </p>
        )}
        {thenEmail && (
          <p className="rounded-lg bg-page px-3 py-2 text-xs text-body">
            Next you choose when it is emailed to you.
          </p>
        )}
      </form>
    </Dialog>
  );
}
