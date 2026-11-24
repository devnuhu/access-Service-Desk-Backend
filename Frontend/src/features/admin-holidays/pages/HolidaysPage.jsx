import { useRef, useState } from "react";
import { CalendarOff, Info, Plus } from "lucide-react";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  PageHeader,
  Spinner,
  useToast,
} from "@/shared/ui";
import {
  useCreateHoliday,
  useDeleteHoliday,
  useHolidays,
} from "../hooks/useHolidays.js";
import { formatHolidayDate } from "../dates.js";

/** This year in Lagos. */
function currentYear() {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      year: "numeric",
    }).format(new Date()),
  );
}

const field = (error) =>
  `mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`;

/** Date and name; the server's refusal (400, 409) shows under the form. */
function AddHolidayDialog({ onClose, onSaved }) {
  const create = useCreateHoliday();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState({});
  const dateRef = useRef(null);

  const save = async (event) => {
    event.preventDefault();
    const value = name.trim();
    const found = {};
    if (!date) found.date = "Choose a date.";
    if (value.length < 2 || value.length > 100)
      found.name = "Use 2 to 100 characters.";
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const holiday = await create.mutateAsync({ date, name: value });
      onSaved(holiday);
    } catch (failure) {
      // A field the server named shows under it; anything else (409, a year out of range) on top.
      const date = failure.fieldErrors?.date?.[0];
      const name = failure.fieldErrors?.name?.[0];
      setErrors({
        date,
        name,
        form: date || name ? undefined : failure.message,
      });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add holiday"
      description="The SLA clock will not run on this day."
      initialFocusRef={dateRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="holiday-form" busy={create.isPending}>
            Add holiday
          </Button>
        </>
      }
    >
      <form id="holiday-form" onSubmit={save} noValidate className="space-y-4">
        {errors.form && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {errors.form}
          </p>
        )}
        <div>
          <label
            htmlFor="holiday-date"
            className="block text-sm font-semibold text-ink"
          >
            Date
          </label>
          <input
            ref={dateRef}
            id="holiday-date"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setErrors({});
            }}
            aria-invalid={errors.date ? "true" : undefined}
            aria-describedby={errors.date ? "holiday-date-error" : undefined}
            className={field(errors.date)}
          />
          {errors.date && (
            <p
              id="holiday-date-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.date}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="holiday-name"
            className="block text-sm font-semibold text-ink"
          >
            Name
          </label>
          <input
            id="holiday-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setErrors({});
            }}
            placeholder="For example, Independence Day"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "holiday-name-error" : undefined}
            className={field(errors.name)}
          />
          {errors.name && (
            <p
              id="holiday-name-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.name}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Administration > Holidays (Super Admin): company holidays for one year (this year, the one
 * before or the one after). The SLA clock skips them straight away, so deadlines move out. Rows
 * from the server settings (fromConfig) are shown but cannot be removed here.
 */
export default function HolidaysPage() {
  const toast = useToast();
  const thisYear = currentYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const [year, setYear] = useState(thisYear);
  const holidays = useHolidays(year);
  const remove = useDeleteHoliday();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  const list = holidays.data ?? [];

  const added = (holiday) => {
    setAdding(false);
    toast.success(`${formatHolidayDate(holiday.date)} is now a holiday.`, {
      title: `${holiday.name} added`,
    });
    const addedYear = Number(holiday.date.slice(0, 4));
    if (years.includes(addedYear)) setYear(addedYear);
  };

  const confirmRemove = async () => {
    try {
      const result = await remove.mutateAsync(removing.id);
      toast.success(result.message, { title: `${removing.name} removed` });
    } catch (error) {
      toast.error(error.message, { title: `${removing.name} not removed` });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Holidays"
        description="Company holidays. Deadlines skip them, as they skip weekends."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" size={16} />
            Add holiday
          </Button>
        }
      />

      <p className="flex items-start gap-2.5 rounded-card border border-brand-navy/15 bg-brand-navy-light px-4 py-3 text-sm text-ink">
        <Info
          aria-hidden="true"
          size={17}
          className="mt-0.5 shrink-0 text-brand-navy"
        />
        The SLA clock does not run on these days or on weekends. Tickets keep
        their raised date; only deadlines move.
      </p>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div
            role="group"
            aria-label="Year"
            className="inline-flex gap-1 rounded-lg border border-line bg-page/60 p-1"
          >
            {years.map((y) => (
              <button
                key={y}
                type="button"
                aria-pressed={y === year}
                onClick={() => setYear(y)}
                className={`rounded-md px-3 py-1 text-sm font-semibold tabular-nums ${y === year ? "bg-white text-brand-navy shadow-card ring-1 ring-line" : "text-muted hover:text-ink"}`}
              >
                {y}
              </button>
            ))}
          </div>
          {holidays.isSuccess && (
            <span className="text-sm text-muted">
              {list.length} {list.length === 1 ? "holiday" : "holidays"} in{" "}
              {year}
            </span>
          )}
        </div>

        {holidays.isLoading ? (
          <div className="px-5 py-10 text-center text-muted">
            <Spinner label="Loading holidays…" />
          </div>
        ) : holidays.isError ? (
          <p
            role="alert"
            className="px-5 py-10 text-center text-sm text-danger"
          >
            {holidays.error.message}
          </p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <CalendarOff aria-hidden="true" size={28} className="text-muted" />
            <p className="font-semibold text-ink">No holidays in {year}</p>
            <p className="text-sm text-muted">
              Deadlines count every weekday this year. Add the public holidays
              when they are announced.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-page/60 text-[12px] font-semibold tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3">
                    Date
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Source
                  </th>
                  <th scope="col" className="px-5 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((holiday) => (
                  <tr
                    key={holiday.id ?? `config-${holiday.date}`}
                    data-testid={`holiday-${holiday.date}`}
                  >
                    <td className="px-5 py-3 font-semibold whitespace-nowrap text-ink">
                      <time dateTime={holiday.date}>
                        {formatHolidayDate(holiday.date)}
                      </time>
                    </td>
                    <td className="px-5 py-3 text-body">{holiday.name}</td>
                    <td className="px-5 py-3">
                      {holiday.fromConfig ? (
                        <Chip tone="grey">Server settings</Chip>
                      ) : (
                        <Chip tone="navy">Added here</Chip>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        {!holiday.fromConfig && holiday.id && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setRemoving(holiday)}
                          >
                            Remove{" "}
                            <span className="sr-only">{holiday.name}</span>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <AddHolidayDialog onClose={() => setAdding(false)} onSaved={added} />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? ""} (${removing ? formatHolidayDate(removing.date) : ""})?`}
        message="Deadlines will count this day again."
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
