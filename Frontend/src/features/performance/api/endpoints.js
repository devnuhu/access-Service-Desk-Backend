import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .optional()
    .transform((items) => items ?? []);

/** A measure that may have nothing to measure: null means "No data", never 0. */
const maybe = z.number().nullable().optional().default(null);

/**
 * The figures of a person or a unit. Counts are whole numbers; percentages (0 to 100) and
 * averages (business hours) are null when there is nothing to measure.
 */
export const figuresSchema = z.looseObject({
  assigned: z.number().int(),
  resolved: z.number().int(),
  openNow: z.number().int(),
  onHold: z.number().int(),
  resolvedLate: z.number().int(),
  withinSlaPercent: maybe,
  avgResolutionHours: maybe,
  avgFirstResponseHours: maybe,
  respondedInTimePercent: maybe,
  noResponseInTime: z.number().int(),
  reopenedPercent: maybe,
});

const periodSchema = z.looseObject({
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  /** day, week or month: what one point of the series covers. */
  bucket: z.string(),
});

/** One bucket; gaps come filled with zeros (withinSlaPercent stays null). */
const pointSchema = z.looseObject({
  date: z.string(),
  assigned: z.number().int(),
  resolved: z.number().int(),
  raised: z.number().int(),
  withinSlaPercent: maybe,
});

const countSchema = z.looseObject({ label: z.string(), count: z.number() });

const targetSchema = z.looseObject({
  priority: z.number().int(),
  priorityName: z.string(),
  responseHours: z.number(),
  resolutionHours: z.number(),
});

export const performanceSchema = z.looseObject({
  period: periodSchema,
  userId: z.string(),
  name: z.string(),
  figures: figuresSchema,
  /** The unit averages to compare with (efficiency figures); null when in no unit. */
  team: figuresSchema.nullable().optional().default(null),
  series: list(pointSchema),
  openByStatus: list(countSchema),
  targets: list(targetSchema),
});

export const unitPerformanceSchema = z.looseObject({
  period: periodSchema,
  unitId: z.string(),
  unitName: z.string(),
  figures: figuresSchema,
  members: list(
    z.looseObject({
      /** Null for someone who has left, or two people sharing one name: no drill-down. */
      userId: z.string().nullable().optional().default(null),
      name: z.string(),
      isHead: z.boolean(),
      figures: figuresSchema,
    }),
  ),
  series: list(pointSchema),
  openByStatus: list(countSchema),
  openByPriority: list(countSchema),
  openByAge: list(countSchema),
  categories: list(
    z.looseObject({
      name: z.string(),
      tickets: z.number(),
      avgResolutionHours: maybe,
      withinSlaPercent: maybe,
    }),
  ),
  targets: list(targetSchema),
});

/**
 * All three take preset (today, last7, last30, thismonth, lastmonth, thisquarter, thisyear, all)
 * or from and to (yyyy-MM-dd; these win). 400: a bad range.
 */
const PERIOD_QUERY = ["preset", "from", "to"];

/** My own performance (anyone signed in). */
export const getMyPerformance = defineEndpoint({
  method: "GET",
  path: "/api/performance/me",
  query: PERIOD_QUERY,
  response: performanceSchema,
});

/** One of my people (head, HOD, Department Admin, Super Admin); 404 otherwise. */
export const getPersonPerformance = defineEndpoint({
  method: "GET",
  path: "/api/performance/people/{userId}",
  query: PERIOD_QUERY,
  response: performanceSchema,
});

/** A unit (its head, HOD, Department Admin, Super Admin); 403 otherwise. */
export const getUnitPerformance = defineEndpoint({
  method: "GET",
  path: "/api/performance/units/{unitId}",
  query: PERIOD_QUERY,
  response: unitPerformanceSchema,
});
