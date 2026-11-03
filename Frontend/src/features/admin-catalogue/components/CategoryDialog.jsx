import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { TriangleAlert } from "lucide-react";
import { PRIORITY, PRIORITY_LABELS } from "@/features/catalogue";
import { applyFieldErrors } from "@/shared/lib/http";
import { zodResolver } from "@/shared/lib/zodResolver";
import { Button, Dialog } from "@/shared/ui";

const FIELDS = [
  "unitId",
  "name",
  "description",
  "timelineHours",
  "defaultPriority",
  "sortOrder",
];

const hours = z
  .number({ error: "Enter a number of business hours." })
  .int("Use whole hours.")
  .min(1, "Between 1 and 720 business hours.")
  .max(720, "Between 1 and 720 business hours.");

const baseSchema = z.object({
  unitId: z.string().min(1, "Choose a unit."),
  name: z
    .string()
    .trim()
    .min(2, "Use 2 to 100 characters.")
    .max(100, "Use 2 to 100 characters."),
  description: z.string().trim().max(300, "At most 300 characters."),
  timelineHours: hours,
  defaultPriority: z.number().int().min(1).max(4),
});

const editSchema = baseSchema.extend({
  sortOrder: z
    .number({ error: "Enter a number." })
    .int("Use a whole number.")
    .min(0, "Between 0 and 9999.")
    .max(9999, "Between 0 and 9999."),
});

const inputClass = (invalid) =>
  `mt-1 w-full rounded-[6px] border px-3 text-sm text-ink ${invalid ? "border-danger" : "border-line"}`;

function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error.message}
        </p>
      )}
    </div>
  );
}

const describedBy = (id, error, hint) =>
  [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") ||
  undefined;

/**
 * Add or edit a category. `units` are the department's active units ({ id, name }).
 * Edit (`category` given) adds Order and sends only the fields that changed; choosing another unit
 * shows the move warning before saving. `onSave(body)` returns the mutation promise; on failure its
 * message shows in the dialog and its field errors under the fields.
 */
export default function CategoryDialog({
  category,
  units,
  initialUnitId = "",
  onClose,
  onSave,
}) {
  const editing = Boolean(category);
  const [failure, setFailure] = useState(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(editing ? editSchema : baseSchema),
    defaultValues: editing
      ? {
          unitId: category.unitId,
          name: category.name,
          description: category.description ?? "",
          timelineHours: category.timelineHours,
          defaultPriority: category.defaultPriority,
          sortOrder: category.sortOrder,
        }
      : {
          unitId: initialUnitId,
          name: "",
          description: "",
          timelineHours: 24,
          defaultPriority: PRIORITY.Medium,
        },
  });
  const unitId = useWatch({ control, name: "unitId" });
  const moving = editing && unitId && unitId !== category.unitId;
  const newUnitName = units.find((unit) => unit.id === unitId)?.name;

  // A category in a unit that is now switched off still shows its unit.
  const options =
    editing && !units.some((unit) => unit.id === category.unitId)
      ? [{ id: category.unitId, name: category.unitName }, ...units]
      : units;

  const onSubmit = async (values) => {
    setFailure(null);
    const description = values.description.trim();
    let body;
    if (editing) {
      body = {};
      if (values.name !== category.name) body.name = values.name;
      if (description !== (category.description ?? ""))
        body.description = description;
      if (values.unitId !== category.unitId) body.unitId = values.unitId;
      if (values.timelineHours !== category.timelineHours)
        body.timelineHours = values.timelineHours;
      if (values.defaultPriority !== category.defaultPriority)
        body.defaultPriority = values.defaultPriority;
      if (values.sortOrder !== category.sortOrder)
        body.sortOrder = values.sortOrder;
      if (!Object.keys(body).length) {
        onClose();
        return;
      }
    } else {
      body = {
        unitId: values.unitId,
        name: values.name,
        timelineHours: values.timelineHours,
        defaultPriority: values.defaultPriority,
        ...(description ? { description } : {}),
      };
    }
    try {
      await onSave(body);
      onClose();
    } catch (error) {
      applyFieldErrors(error, setError, FIELDS);
      setFailure(error.message);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? `Edit ${category.name}` : "Add category"}
      description="Requesters pick a category and describe the request in the ticket."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" busy={isSubmitting}>
            {moving ? "Move and save" : editing ? "Save" : "Add category"}
          </Button>
        </>
      }
    >
      <form
        id="category-form"
        className="space-y-4"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        {failure && (
          <p
            role="alert"
            className="rounded-[6px] border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {failure}
          </p>
        )}
        <Field id="category-unit" label="Unit" error={errors.unitId}>
          <select
            id="category-unit"
            aria-invalid={errors.unitId ? "true" : undefined}
            aria-describedby={describedBy("category-unit", errors.unitId)}
            className={`${inputClass(errors.unitId)} h-10 bg-white`}
            {...register("unitId")}
          >
            {!editing && <option value="">Choose a unit</option>}
            {options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>
        {moving && (
          <p
            role="note"
            data-testid="move-warning"
            className="flex gap-2 rounded-[6px] border border-brand-orange bg-brand-orange-light px-3 py-2 text-sm text-brand-orange-ink"
          >
            <TriangleAlert
              aria-hidden="true"
              size={16}
              className="mt-0.5 shrink-0"
            />
            Case workers who are not in {newUnitName} will stop handling this
            category.
          </p>
        )}
        <Field id="category-name" label="Name" error={errors.name}>
          <input
            id="category-name"
            autoComplete="off"
            maxLength={100}
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={describedBy("category-name", errors.name)}
            className={`${inputClass(errors.name)} h-10`}
            {...register("name")}
          />
        </Field>
        <Field
          id="category-description"
          label={
            <>
              Description{" "}
              <span className="font-normal text-muted">(optional)</span>
            </>
          }
          hint="Shown to requesters when choosing. At most 300 characters."
          error={errors.description}
        >
          <textarea
            id="category-description"
            rows={2}
            maxLength={300}
            aria-invalid={errors.description ? "true" : undefined}
            aria-describedby={describedBy(
              "category-description",
              errors.description,
              true,
            )}
            className={`${inputClass(errors.description)} py-2`}
            {...register("description")}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="category-timeline"
            label="Timeline (business hours)"
            hint="1 to 720"
            error={errors.timelineHours}
          >
            <input
              id="category-timeline"
              type="number"
              min={1}
              max={720}
              step={1}
              aria-invalid={errors.timelineHours ? "true" : undefined}
              aria-describedby={describedBy(
                "category-timeline",
                errors.timelineHours,
                true,
              )}
              className={`${inputClass(errors.timelineHours)} h-10`}
              {...register("timelineHours", { valueAsNumber: true })}
            />
          </Field>
          <Field
            id="category-priority"
            label="Default priority"
            error={errors.defaultPriority}
          >
            <select
              id="category-priority"
              className={`${inputClass(errors.defaultPriority)} h-10 bg-white`}
              {...register("defaultPriority", { valueAsNumber: true })}
            >
              {Object.values(PRIORITY).map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {editing && (
          <Field
            id="category-order"
            label="Order"
            hint="Lower numbers come first in the list requesters see."
            error={errors.sortOrder}
          >
            <input
              id="category-order"
              type="number"
              min={0}
              max={9999}
              step={1}
              aria-invalid={errors.sortOrder ? "true" : undefined}
              aria-describedby={describedBy(
                "category-order",
                errors.sortOrder,
                true,
              )}
              className={`${inputClass(errors.sortOrder)} h-10 sm:w-40`}
              {...register("sortOrder", { valueAsNumber: true })}
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
