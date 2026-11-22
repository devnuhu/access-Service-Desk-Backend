/** How a schedule reads on screen, and the form values to and from the API body. */

export const MAX_SCHEDULES = 10;

/** 8 -> "08:00" (Lagos time). */
export function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(day) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/**
 * "Every working day at 08:00", "Every Monday at 09:00", "Monthly on the 5th at 08:00".
 * Daily means Monday to Friday, public holidays left out.
 */
export function describeSchedule({
  frequency,
  weekDay,
  weekDays,
  dayOfMonth,
  sendHour,
}) {
  const at = `at ${hourLabel(sendHour)}`;
  if (frequency === "custom")
    return `${(weekDays ?? []).map((day) => day.slice(0, 3)).join(", ")} ${at}`;
  if (frequency === "weekly") return `Every ${weekDay} ${at}`;
  if (frequency === "monthly")
    return `Monthly on the ${ordinal(dayOfMonth)} ${at}`;
  return `Every working day ${at}`;
}

export const FORMAT_LABELS = { xlsx: "Excel", csv: "CSV" };

export const FREQUENCY_LABELS = {
  daily: "Every working day",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom (chosen weekdays)",
};

/** Tag tone and what each last result means. */
export const STATUS = {
  Sent: { tone: "green", label: "Sent" },
  Skipped: {
    tone: "grey",
    label: "Skipped",
    help: "Nothing was sent for that period.",
  },
  Retrying: {
    tone: "orange",
    label: "Retrying",
    help: "The send failed and will be tried again within a few minutes.",
  },
  Failed: {
    tone: "red",
    label: "Failed",
    help: "The send failed three times, so that period was given up. The next period will try again.",
  },
};

/**
 * The form's starting values: an existing schedule, or a new one for `savedReportId`. `defaults`
 * pre-set a new one (the daily team report: every working day at 17:00).
 */
export function formValues(schedule, savedReportId = "", defaults = {}) {
  return {
    savedReportId: schedule?.savedReportId ?? savedReportId,
    frequency: schedule?.frequency ?? defaults.frequency ?? "daily",
    weekDay: schedule?.weekDay ?? "Monday",
    weekDays: schedule?.weekDays ?? [],
    dayOfMonth: schedule?.dayOfMonth ?? 1,
    sendHour: schedule?.sendHour ?? defaults.sendHour ?? 8,
    format: schedule?.format ?? "xlsx",
    enabled: schedule?.enabled ?? true,
    cc: schedule?.cc ?? [],
  };
}

/** The request body: weekDay only for weekly, weekDays only for custom, dayOfMonth only for monthly; cc always. */
export function toBody(values) {
  const body = {
    savedReportId: values.savedReportId,
    frequency: values.frequency,
    sendHour: Number(values.sendHour),
    format: values.format,
    enabled: Boolean(values.enabled),
  };
  if (values.frequency === "weekly") body.weekDay = values.weekDay;
  if (values.frequency === "monthly")
    body.dayOfMonth = Number(values.dayOfMonth);
  if (values.frequency === "custom")
    body.weekDays = [...(values.weekDays ?? [])];
  body.cc = (values.cc ?? []).map(({ name, email }) => ({ name, email }));
  return body;
}
