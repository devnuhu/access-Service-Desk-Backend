import { useState } from "react";
import { useCategories } from "@/features/admin-catalogue";
import { PRIORITY, PRIORITY_LABELS } from "@/features/catalogue";
import { useOrgDepartments } from "@/features/org";
import { Button, Dialog } from "@/shared/ui";
import { useSaveSlaPolicy } from "../hooks/useSlaPolicies.js";

/** Critical first, as the default targets are listed. */
const PRIORITIES = [
  PRIORITY.Critical,
  PRIORITY.High,
  PRIORITY.Medium,
  PRIORITY.Low,
];

const FIELDS = [
  "responseHours",
  "resolutionHours",
  "departmentId",
  "categoryId",
  "priority",
];

/** The first form field the server's errors name (any letter case), with its message. */
function namedField(error) {
  const entries = Object.entries(error?.fieldErrors ?? {});
  for (const field of FIELDS) {
    const hit = entries.find(
      ([key]) => key.toLowerCase() === field.toLowerCase(),
    );
    const message = hit && [].concat(hit[1])[0];
    if (message) return { field, message };
  }
  return null;
}

/**
 * When the server's message names no field: put it under the field it is about, by its words;
 * anything else shows above the form.
 */
function fieldOf(message) {
  // "Resolution … shorter than the first-response time" is about resolution: check it first.
  if (/resolution/i.test(message)) return "resolutionHours";
  if (/first-response/i.test(message)) return "responseHours";
  if (/categor/i.test(message)) return "categoryId";
  if (/department/i.test(message)) return "departmentId";
  if (/low, medium|priority/i.test(message)) return "priority";
  return "form";
}

const field = (error) =>
  `mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`;

function FieldMessage({ id, message }) {
  return message ? (
    <p id={id} className="mt-1 text-xs font-medium text-danger">
      {message}
    </p>
  ) : null;
}

/**
 * Add or change a service level. `row` (a policy row) edits it: its scope, department, category and
 * priority stay; only the hours change.
 * Without `row` it adds an override: a department or a category, its priority and hours.
 */
export default function PolicyDialog({ row, onClose, onSaved }) {
  const save = useSaveSlaPolicy();
  const editing = Boolean(row);
  const [scope, setScope] = useState(row?.scope ?? "department");
  const [departmentId, setDepartmentId] = useState(row?.departmentId ?? "");
  const [categoryId, setCategoryId] = useState(row?.categoryId ?? "");
  const [priority, setPriority] = useState(row?.priority ?? PRIORITY.High);
  const [responseHours, setResponseHours] = useState(
    row ? String(row.responseHours) : "",
  );
  const [resolutionHours, setResolutionHours] = useState(
    row ? String(row.resolutionHours) : "",
  );
  const [errors, setErrors] = useState({});
  const departments = useOrgDepartments({
    enabled: !editing,
  });
  const categories = useCategories(
    !editing && scope === "category" ? departmentId : undefined,
  );

  const clear = (name) =>
    setErrors((e) => ({ ...e, [name]: undefined, form: undefined }));

  const submit = async (event) => {
    event.preventDefault();
    const response = Number(responseHours);
    const resolution = Number(resolutionHours);
    const found = {};
    if (!editing && !departmentId)
      found.departmentId = "Choose the department.";
    if (!editing && scope === "category" && !categoryId)
      found.categoryId = "Choose the category.";
    if (!Number.isInteger(response) || response < 1 || response > 720)
      found.responseHours = "Use 1 to 720 working hours.";
    if (!Number.isInteger(resolution) || resolution < 1 || resolution > 4000)
      found.resolutionHours = "Use 1 to 4000 working hours.";
    else if (!found.responseHours && resolution < response)
      found.resolutionHours =
        "The resolution time cannot be shorter than the first-response time.";
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = {
      scope,
      priority,
      responseHours: response,
      resolutionHours: resolution,
    };
    if (scope === "department") body.departmentId = departmentId;
    if (scope === "category") body.categoryId = categoryId;
    try {
      const saved = await save.mutateAsync(body);
      onSaved(saved);
    } catch (error) {
      // A field named by the server wins; otherwise place the message by its words.
      const named = namedField(error);
      setErrors(
        named
          ? { [named.field]: named.message }
          : { [fieldOf(error.message)]: error.message },
      );
    }
  };

  const title = editing
    ? `${PRIORITY_LABELS[row.priority]}: ${row.scope === "global" ? "default" : (row.categoryName ?? row.departmentName)}`
    : "Add override";

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description="Working hours: Monday to Friday, 8 to 5 (Lagos), holidays excluded."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="policy-form" busy={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="policy-form" onSubmit={submit} noValidate className="space-y-4">
        {errors.form && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {errors.form}
          </p>
        )}

        {!editing && (
          <>
            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                Applies to
              </legend>
              <div className="mt-1.5 inline-flex rounded-lg border border-line bg-white p-0.5">
                {[
                  ["department", "Department"],
                  ["category", "Category"],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold ${scope === value ? "bg-brand-navy text-white" : "text-body hover:bg-page"}`}
                  >
                    <input
                      type="radio"
                      name="policy-scope"
                      value={value}
                      checked={scope === value}
                      onChange={() => {
                        setScope(value);
                        setCategoryId("");
                        setErrors({});
                      }}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="policy-department"
                className="block text-sm font-semibold text-ink"
              >
                Department
              </label>
              <select
                id="policy-department"
                value={departmentId}
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setCategoryId("");
                  clear("departmentId");
                }}
                aria-invalid={errors.departmentId ? "true" : undefined}
                aria-describedby={
                  errors.departmentId ? "policy-department-error" : undefined
                }
                className={field(errors.departmentId)}
              >
                <option value="">Choose a department</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <FieldMessage
                id="policy-department-error"
                message={errors.departmentId}
              />
            </div>

            {scope === "category" && (
              <div>
                <label
                  htmlFor="policy-category"
                  className="block text-sm font-semibold text-ink"
                >
                  Category
                </label>
                <select
                  id="policy-category"
                  value={categoryId}
                  disabled={!departmentId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    clear("categoryId");
                  }}
                  aria-invalid={errors.categoryId ? "true" : undefined}
                  aria-describedby={
                    errors.categoryId ? "policy-category-error" : undefined
                  }
                  className={`${field(errors.categoryId)} disabled:bg-page`}
                >
                  <option value="">
                    {departmentId
                      ? "Choose a category"
                      : "Choose the department first"}
                  </option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <FieldMessage
                  id="policy-category-error"
                  message={errors.categoryId}
                />
              </div>
            )}

            <div>
              <label
                htmlFor="policy-priority"
                className="block text-sm font-semibold text-ink"
              >
                Priority
              </label>
              <select
                id="policy-priority"
                value={priority}
                onChange={(event) => {
                  setPriority(Number(event.target.value));
                  clear("priority");
                }}
                aria-invalid={errors.priority ? "true" : undefined}
                className={field(errors.priority)}
              >
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </option>
                ))}
              </select>
              <FieldMessage
                id="policy-priority-error"
                message={errors.priority}
              />
            </div>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="policy-response"
              className="block text-sm font-semibold text-ink"
            >
              First response (hours)
            </label>
            <input
              id="policy-response"
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              value={responseHours}
              onChange={(event) => {
                setResponseHours(event.target.value);
                clear("responseHours");
              }}
              aria-invalid={errors.responseHours ? "true" : undefined}
              aria-describedby={
                errors.responseHours ? "policy-response-error" : undefined
              }
              className={field(errors.responseHours)}
            />
            <FieldMessage
              id="policy-response-error"
              message={errors.responseHours}
            />
          </div>
          <div>
            <label
              htmlFor="policy-resolution"
              className="block text-sm font-semibold text-ink"
            >
              Resolution (hours)
            </label>
            <input
              id="policy-resolution"
              type="number"
              inputMode="numeric"
              min={1}
              max={4000}
              value={resolutionHours}
              onChange={(event) => {
                setResolutionHours(event.target.value);
                clear("resolutionHours");
              }}
              aria-invalid={errors.resolutionHours ? "true" : undefined}
              aria-describedby={
                errors.resolutionHours ? "policy-resolution-error" : undefined
              }
              className={field(errors.resolutionHours)}
            />
            <FieldMessage
              id="policy-resolution-error"
              message={errors.resolutionHours}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
