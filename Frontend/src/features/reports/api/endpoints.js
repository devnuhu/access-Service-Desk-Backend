import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/**
 * Reports (Step 9): for unit heads, Heads of Department, Department Admins and Super Admin. Anyone
 * else gets 403. A report always runs with the viewer's own scope, shared or not.
 */

/**
 * A report definition (ReportSpec). Every field is declared and unknown ones are kept, so a
 * definition from the catalogue or a saved report goes back to the server unchanged. Dates are
 * Lagos dates (yyyy-MM-dd); preset wins over from and to.
 */
export const definitionSchema = z.looseObject({
  title: z.string().nullable().optional(),
  source: z.string().optional(),
  mode: z.string().optional(),
  preset: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  dateField: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  unitIds: z.array(z.string()).nullable().optional(),
  categoryIds: z.array(z.string()).nullable().optional(),
  assigneeIds: z.array(z.string()).nullable().optional(),
  statuses: z.array(z.string()).nullable().optional(),
  priorities: z.array(z.string()).nullable().optional(),
  escalated: z.boolean().nullable().optional(),
  slaBreached: z.boolean().nullable().optional(),
  groupBy: z.string().optional(),
  measures: z.array(z.string()).nullable().optional(),
  columns: z.array(z.string()).nullable().optional(),
  sortBy: z.string().nullable().optional(),
  sortDescending: z.boolean().optional(),
  limit: z.number().int().nullable().optional(),
  chart: z.string().optional(),
});

const optionSchema = z.object({ key: z.string(), label: z.string() });

/** The date presets and the ready-made reports (R1 to R11, whatever the server lists) with their definitions. */
export const getReportCatalogue = defineEndpoint({
  method: "GET",
  path: "/api/reports/catalogue",
  response: z.object({
    presets: z
      .array(optionSchema)
      .nullable()
      .transform((items) => items ?? []),
    builtIn: z
      .array(
        z.object({
          code: z.string(),
          name: z.string(),
          description: z.string(),
          definition: definitionSchema,
        }),
      )
      .nullable()
      .transform((items) => items ?? []),
  }),
});

const savedReportSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  ownerName: z.string(),
  isMine: z.boolean(),
  /** private, unit, department or roles */
  share: z.string(),
  shareUnitId: z.string().nullable(),
  shareDepartmentId: z.string().nullable(),
  shareRoles: z
    .array(z.string())
    .nullable()
    .transform((roles) => roles ?? []),
  definition: definitionSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const SHARE_ROLES = ["HeadOfUnit", "HOD", "DepartmentAdmin"];

/** SaveReportRequest: the same body for saving and for changing a saved report. */
export const saveReportBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Use 2 to 150 characters.")
      .max(150, "Use 2 to 150 characters."),
    description: z
      .string()
      .trim()
      .max(500, "Use at most 500 characters.")
      .optional(),
    definition: definitionSchema,
    share: z.enum(["private", "unit", "department", "roles"]),
    shareUnitId: z.string().optional(),
    shareDepartmentId: z.string().optional(),
    shareRoles: z.array(z.enum(SHARE_ROLES)).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.share === "unit" && !body.shareUnitId)
      ctx.addIssue({
        code: "custom",
        path: ["shareUnitId"],
        message: "Choose the unit to share with.",
      });
    if (body.share === "department" && !body.shareDepartmentId)
      ctx.addIssue({
        code: "custom",
        path: ["shareDepartmentId"],
        message: "Choose the department to share with.",
      });
    if (body.share === "roles" && !body.shareRoles?.length)
      ctx.addIssue({
        code: "custom",
        path: ["shareRoles"],
        message: "Choose at least one role.",
      });
  });

/** Saves a definition as your report. 400 / 403 (share not yours) / 409 (name taken, or 50 already). */
export const createSavedReport = defineEndpoint({
  method: "POST",
  path: "/api/reports/saved",
  body: saveReportBody,
  response: savedReportSchema,
});

/** The owner changes the name, the definition or who can see it. 400 / 403 / 404 / 409. */
export const updateSavedReport = defineEndpoint({
  method: "PUT",
  path: "/api/reports/saved/{id}",
  body: saveReportBody,
  response: savedReportSchema,
});

/** Yours and the ones shared with you, newest first. */
export const listSavedReports = defineEndpoint({
  method: "GET",
  path: "/api/reports/saved",
  response: z
    .array(savedReportSchema)
    .nullable()
    .transform((items) => items ?? []),
});

/** The owner deletes it; its email schedules go with it. 403 / 404. */
export const deleteSavedReport = defineEndpoint({
  method: "DELETE",
  path: "/api/reports/saved/{id}",
  response: z.object({ message: z.string() }),
});

/** Type is text, number, percent (0 to 100), hours, date, datetime or boolean. */
const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
});

/** A row: its values in the order of `columns` (cell i belongs to column i). */
const rowSchema = z.array(z.unknown());

const resultSchema = z.object({
  title: z.string(),
  /** table, bar, line or pie */
  chart: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  columns: z.array(columnSchema),
  rows: z.array(rowSchema),
  /** In column order too ("Total" first); null when the report has no grouping. */
  totals: rowSchema.nullable(),
  truncated: z.boolean(),
  generatedAt: z.string(),
});

/** Runs a definition with your own scope and returns the table. Nothing is saved. */
export const runReport = defineEndpoint({
  method: "POST",
  path: "/api/reports/run",
  body: definitionSchema,
  response: resultSchema,
});

/** Runs a definition and downloads it. format = xlsx (default) or csv. */
export const exportReport = defineEndpoint({
  method: "POST",
  path: "/api/reports/export",
  query: ["format"],
  body: definitionSchema,
  responseType: "blob",
});

/** Runs a saved report with your own scope. Nothing about the report changes. */
export const runSavedReport = defineEndpoint({
  method: "POST",
  path: "/api/reports/saved/{id}/run",
  response: resultSchema,
});

/** Downloads a saved report, run with your own scope. format = xlsx (default) or csv. */
export const exportSavedReport = defineEndpoint({
  method: "POST",
  path: "/api/reports/saved/{id}/export",
  query: ["format"],
  responseType: "blob",
});

export const FREQUENCIES = ["daily", "weekly", "monthly"];
export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const FORMATS = ["xlsx", "csv"];

const scheduleSchema = z.object({
  id: z.string(),
  savedReportId: z.string(),
  reportName: z.string(),
  frequency: z.string(),
  weekDay: z.string().nullable(),
  dayOfMonth: z.number().nullable(),
  sendHour: z.number(),
  format: z.string(),
  enabled: z.boolean(),
  /** UTC; empty when the schedule is switched off. */
  nextRunAt: z.string().nullable(),
  lastSentAt: z.string().nullable(),
  /** Sent, Skipped, Retrying or Failed; empty before the first try. */
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

/**
 * weekDay only for weekly, dayOfMonth (1 to 28) only for monthly; sendHour is the Lagos hour.
 * The same checks as the server, so a bad form never leaves the browser.
 */
const scheduleBody = z
  .object({
    savedReportId: z.string().min(1, "Choose a saved report."),
    frequency: z.enum(FREQUENCIES),
    weekDay: z.enum(WEEK_DAYS).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    sendHour: z.number().int().min(0).max(23),
    format: z.enum(FORMATS),
    enabled: z.boolean(),
  })
  .superRefine((body, ctx) => {
    if (body.frequency === "weekly" && !body.weekDay)
      ctx.addIssue({
        code: "custom",
        path: ["weekDay"],
        message: "Choose a day of the week.",
      });
    if (body.frequency === "monthly" && body.dayOfMonth === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["dayOfMonth"],
        message: "Choose a day from 1 to 28.",
      });
  });

/** Your schedules only, with the next send time and the last result. */
export const listReportSchedules = defineEndpoint({
  method: "GET",
  path: "/api/reports/schedules",
  response: z
    .array(scheduleSchema)
    .nullable()
    .transform((items) => items ?? []),
});

/** 400 bad values / 403 no reports / 404 report not found / 409 one per report, or 10 already. */
export const createReportSchedule = defineEndpoint({
  method: "POST",
  path: "/api/reports/schedules",
  body: scheduleBody,
  response: scheduleSchema,
});

/** Change it, or switch it on or off. Saving resets the first send to the next scheduled time. */
export const updateReportSchedule = defineEndpoint({
  method: "PUT",
  path: "/api/reports/schedules/{id}",
  body: scheduleBody,
  response: scheduleSchema,
});

export const deleteReportSchedule = defineEndpoint({
  method: "DELETE",
  path: "/api/reports/schedules/{id}",
  response: z.object({ message: z.string() }),
});
