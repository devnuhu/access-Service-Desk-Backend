import { useId, useState } from "react";
import { Button, Dialog, Switch } from "@/shared/ui";
import { formatWat } from "@/shared/lib/time";
import { FORMATS, WEEK_DAYS, WORK_DAYS } from "../api/endpoints.js";
import {
  useCreateSchedule,
  useRefreshSavedReports,
  useUpdateSchedule,
} from "../hooks/useReports.js";
import { isGone } from "../savedReport.js";
import CcPicker from "./CcPicker.jsx";
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

/** The server answers a bad value with a message: put it by the control it is about. */
function errorField(message) {
  if (/weekday/i.test(message)) return "weekDays";
  if (/copy|email address/i.test(message)) return "cc";
  return "form";
}

/**
 * Add a schedule (`savedReportId` preselects the report) or change one (`schedule`). The report is
 * sent to the person who saves it, with their own scope, at the next scheduled time after saving,
 * and to the people they copy (up to 10, from the staff directory). Custom sends on the chosen
 * working days. `defaults` pre-set a new one (frequency, sendHour).
 * `scheduledReportIds`: reports that already have a schedule (one per report), not offered again.
 */
export default function ScheduleDialog({
  schedule,
  savedReportId,
  defaults,
  savedReports,
  scheduledReportIds,
  onClose,
  onSaved,
}) {
  const editing = Boolean(schedule);
  const [values, setValues] = useState(() =>
    formValues(schedule, savedReportId, defaults),
  );
  // { form?, weekDays?, cc? }
  const [errors, setErrors] = useState({});
  const error = errors.form;
  const setError = (message) => setErrors(message ? { form: message } : {});
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
    setErrors({});
  };
  const toggleDay = (day) =>
    set("weekDays")(
      values.weekDays.includes(day)
        ? values.weekDays.filter((d) => d !== day)
        : WORK_DAYS.filter((d) => d === day || values.weekDays.includes(d)),
    );
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
    if (values.frequency === "custom" && values.weekDays.length === 0) {
      setErrors({ weekDays: "Choose at least one weekday." });
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
      setErrors({ [errorField(failure.message)]: failure.message });
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={
        editing ? `Email schedule: ${schedule.reportName}` : "Email me a report"
      }
      description="Sent to you, and to anyone you copy. Shows only what you are allowed to see."
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

        {values.frequency === "custom" && (
          <fieldset
            aria-describedby={
              errors.weekDays ? "schedule-days-error" : undefined
            }
          >
            <legend className="text-sm font-semibold text-ink">
              On these days
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {WORK_DAYS.map((day) => {
                const on = values.weekDays.includes(day);
                return (
                  <label
                    key={day}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-brand-navy bg-brand-navy-light text-brand-navy" : "border-line bg-white text-body"}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleDay(day)}
                      className="h-4 w-4 accent-brand-navy"
                    />
                    {day}
                  </label>
                );
              })}
            </div>
            {errors.weekDays && (
              <p
                id="schedule-days-error"
                className="mt-1 text-xs font-medium text-danger"
              >
                {errors.weekDays}
              </p>
            )}
          </fieldset>
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

        <CcPicker value={values.cc} onChange={set("cc")} error={errors.cc} />

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
          The first email goes out at the next scheduled time after you save.
        </p>
      </form>
    </Dialog>
  );
}
