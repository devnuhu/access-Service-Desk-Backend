import { useId, useState } from "react";
import { Button, Dialog, Switch } from "@/shared/ui";
import { formatWat } from "@/shared/lib/time";
import { FORMATS, WEEK_DAYS } from "../api/endpoints.js";
import {
  useCreateSchedule,
  useRefreshSavedReports,
  useUpdateSchedule,
} from "../hooks/useReports.js";
import { isGone } from "../savedReport.js";
import {
  FORMAT_LABELS,
  FREQUENCY_LABELS,
  formValues,
  hourLabel,
  ordinal,
  toBody,
} from "../schedule.js";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

const inputClass =
  "mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink disabled:bg-page disabled:text-muted";

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Add a schedule (`savedReportId` preselects the report) or change one (`schedule`). The report is
 * sent to the person who saves it, with their own scope, at the next scheduled time after saving.
 * `scheduledReportIds`: reports that already have a schedule (one per report), not offered again.
 */
export default function ScheduleDialog({
  schedule,
  savedReportId,
  savedReports,
  scheduledReportIds,
  onClose,
  onSaved,
}) {
  const editing = Boolean(schedule);
  const [values, setValues] = useState(() =>
    formValues(schedule, savedReportId),
  );
  const [error, setError] = useState("");
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const refreshSaved = useRefreshSavedReports();
  const busy = create.isPending || update.isPending;
  const ids = {
    report: useId(),
    frequency: useId(),
    weekDay: useId(),
    day: useId(),
    hour: useId(),
    enabled: useId(),
  };

  const set = (name) => (value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setError("");
  };
  const onInput = (name) => (event) => set(name)(event.target.value);

  // In edit mode the report cannot change; the report may no longer be in the list.
  const reportChoices = editing
    ? [{ id: schedule.savedReportId, name: schedule.reportName }]
    : savedReports;

  const save = async (event) => {
    event.preventDefault();
    if (!values.savedReportId) {
      setError("Choose a saved report.");
      return;
    }
    const body = toBody(values);
    try {
      const saved = editing
        ? await update.mutateAsync({ id: schedule.id, body })
        : await create.mutateAsync(body);
      onSaved(saved);
    } catch (failure) {
      // The report (or the schedule) is gone: the lists catch up.
      if (isGone(failure)) refreshSaved();
      setError(failure.message);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={
        editing ? `Email schedule: ${schedule.reportName}` : "Email me a report"
      }
      description="Sent to you. Shows only what you are allowed to see."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" busy={busy}>
            {editing ? "Save" : "Add schedule"}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={save} noValidate className="space-y-4">
        <Field id={ids.report} label="Saved report">
          <select
            id={ids.report}
            value={values.savedReportId}
            onChange={onInput("savedReportId")}
            disabled={editing}
            className={inputClass}
          >
            {!editing && <option value="">Choose a report</option>}
            {reportChoices.map((report) => {
              const taken = !editing && scheduledReportIds.includes(report.id);
              return (
                <option key={report.id} value={report.id} disabled={taken}>
                  {taken ? `${report.name} (already scheduled)` : report.name}
                </option>
              );
            })}
          </select>
        </Field>

        <Field id={ids.frequency} label="How often">
          <select
            id={ids.frequency}
            value={values.frequency}
            onChange={onInput("frequency")}
            className={inputClass}
          >
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {values.frequency === "daily" && (
            <p className="mt-1 text-xs text-muted">
              Monday to Friday, not on public holidays.
            </p>
          )}
        </Field>

        {values.frequency === "weekly" && (
          <Field id={ids.weekDay} label="Day of the week">
            <select
              id={ids.weekDay}
              value={values.weekDay}
              onChange={onInput("weekDay")}
              className={inputClass}
            >
              {WEEK_DAYS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
        )}

        {values.frequency === "monthly" && (
          <Field
            id={ids.day}
            label="Day of the month"
            hint="1 to 28, so it falls in every month."
          >
            <select
              id={ids.day}
              value={values.dayOfMonth}
              onChange={(event) =>
                set("dayOfMonth")(Number(event.target.value))
              }
              className={inputClass}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field id={ids.hour} label="Time (Lagos time)">
          <select
            id={ids.hour}
            value={values.sendHour}
            onChange={(event) => set("sendHour")(Number(event.target.value))}
            className={inputClass}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold text-ink">File</legend>
          <div className="mt-1 flex gap-4">
            {FORMATS.map((format) => (
              <label key={format} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="schedule-format"
                  value={format}
                  checked={values.format === format}
                  onChange={() => set("format")(format)}
                />
                {FORMAT_LABELS[format]}
              </label>
            ))}
          </div>
        </fieldset>

        <Switch
          id={ids.enabled}
          checked={values.enabled}
          onChange={set("enabled")}
          label={values.enabled ? "On" : "Off"}
          aria-label="Send this report"
        />

        {editing && schedule.nextRunAt && (
          <p className="text-xs text-muted">
            Next email now: {formatWat(schedule.nextRunAt)}. Saving sets it
            again.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <p className="rounded-lg bg-page px-3 py-2 text-xs text-body">
          Sent to you only. The first email goes out at the next scheduled time
          after you save.
        </p>
      </form>
    </Dialog>
  );
}
