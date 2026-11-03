import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CircleAlert } from "lucide-react";
import { addDays } from "@/shared/lib/dates";
import { applyFieldErrors } from "@/shared/lib/http";
import { zodResolver } from "@/shared/lib/zodResolver";
import { Button, useToast } from "@/shared/ui";
import { ABSENCE_KIND } from "../api/endpoints.js";
import { kindLabel } from "../absenceText.js";
import { useRecordAbsence } from "../hooks/useAvailability.js";

const schema = z
  .object({
    kind: z.enum([
      String(ABSENCE_KIND.Leave),
      String(ABSENCE_KIND.OutOfOffice),
    ]),
    startDate: z.string().min(1, "Choose the start date."),
    endDate: z.string().min(1, "Choose the end date."),
    note: z.string().trim().max(200, "At most 200 characters."),
  })
  .refine(
    (values) =>
      !values.startDate ||
      !values.endDate ||
      values.endDate >= values.startDate,
    {
      path: ["endDate"],
      message: "Must be on or after the start date.",
    },
  );

const FIELDS = ["startDate", "endDate", "note", "kind"];

const inputClass = (invalid) =>
  `mt-1 h-10 w-full rounded-[6px] border bg-white px-3 text-sm text-ink ${invalid ? "border-danger" : "border-line"}`;

/**
 * Record leave or out of office, for yourself (no userId) or for someone you manage (userId).
 * `today` is the office date from the API, never the browser's clock (rule 16). Field errors from
 * errors.startDate / errors.endDate go under the fields; any other refusal (409 overlap, 403) is
 * shown above the form.
 */
export default function AbsenceForm({
  userId,
  today,
  onRecorded,
  idPrefix = "absence",
}) {
  const toast = useToast();
  const record = useRecordAbsence();
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: String(ABSENCE_KIND.Leave),
      startDate: today,
      endDate: today,
      note: "",
    },
  });
  const startDate = useWatch({ control, name: "startDate" });

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      await record.mutateAsync({
        ...(userId ? { userId } : {}),
        kind: Number(values.kind),
        startDate: values.startDate,
        endDate: values.endDate,
        ...(values.note ? { note: values.note } : {}),
      });
      toast.success(`${kindLabel(Number(values.kind))} recorded`);
      reset({ kind: values.kind, startDate: today, endDate: today, note: "" });
      onRecorded?.();
    } catch (error) {
      applyFieldErrors(error, setError, FIELDS);
      setFormError(error.message);
    }
  };

  const id = (name) => `${idPrefix}-${name}`;

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Record leave"
    >
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[6px] border border-danger/30 bg-danger-light px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert
            aria-hidden="true"
            size={18}
            className="mt-px shrink-0"
          />
          <span>{formError}</span>
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Kind</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {[ABSENCE_KIND.Leave, ABSENCE_KIND.OutOfOffice].map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-2 text-sm text-ink"
            >
              <input type="radio" value={String(kind)} {...register("kind")} />
              {kindLabel(kind)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={id("start")}
            className="block text-sm font-semibold text-ink"
          >
            Start
          </label>
          <input
            id={id("start")}
            type="date"
            min={addDays(today, -30)}
            aria-invalid={errors.startDate ? "true" : undefined}
            aria-describedby={errors.startDate ? id("start-error") : undefined}
            className={inputClass(errors.startDate)}
            {...register("startDate")}
          />
          {errors.startDate && (
            <p
              id={id("start-error")}
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.startDate.message}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={id("end")}
            className="block text-sm font-semibold text-ink"
          >
            End
          </label>
          <input
            id={id("end")}
            type="date"
            min={startDate || addDays(today, -30)}
            aria-invalid={errors.endDate ? "true" : undefined}
            aria-describedby={errors.endDate ? id("end-error") : undefined}
            className={inputClass(errors.endDate)}
            {...register("endDate")}
          />
          {errors.endDate && (
            <p
              id={id("end-error")}
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.endDate.message}
            </p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor={id("note")}
          className="block text-sm font-semibold text-ink"
        >
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={id("note")}
          maxLength={200}
          aria-describedby={`${id("note-hint")}${errors.note ? ` ${id("note-error")}` : ""}`}
          className={inputClass(errors.note)}
          {...register("note")}
        />
        <p id={id("note-hint")} className="mt-1 text-xs text-muted">
          Do not include customer details.
        </p>
        {errors.note && (
          <p
            id={id("note-error")}
            className="mt-1 text-xs font-medium text-danger"
          >
            {errors.note.message}
          </p>
        )}
      </div>

      <Button type="submit" busy={record.isPending} busyText="Recording…">
        Record
      </Button>
    </form>
  );
}
