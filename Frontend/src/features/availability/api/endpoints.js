import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** kind: 1 Leave, 2 Out of office. */
export const ABSENCE_KIND = Object.freeze({ Leave: 1, OutOfOffice: 2 });

/** staffCategory: 1 Employee, 2 Head of Unit. */
export const STAFF_CATEGORY = Object.freeze({ Employee: 1, HeadOfUnit: 2 });

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/** A whole-day period (Lagos office dates, "yyyy-MM-dd", start and end included). */
const absenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  note: z.string().nullable(),
  recordedBy: z.string().nullable(),
  recordedAt: z.string(),
});

const unitAvailabilitySchema = z.object({
  unitId: z.string(),
  departmentId: z.string(),
  code: z.string().nullable(),
  name: z.string().nullable(),
  today: z.string(),
  memberCount: z.number(),
  availableCount: z.number(),
  members: list(
    z.object({
      userId: z.string(),
      userName: z.string().nullable(),
      fullName: z.string().nullable(),
      staffCategory: z.number().int(),
      isHead: z.boolean(),
      accountActive: z.boolean(),
      availableNow: z.boolean(),
      current: absenceSchema.nullable(),
      upcoming: list(absenceSchema),
    }),
  ),
});

/** My availability today ("today" is the Lagos office date from the API), and my current and future periods. */
export const getMyAvailability = defineEndpoint({
  method: "GET",
  path: "/api/availability/me",
  response: z.object({
    today: z.string(),
    inStructure: z.boolean(),
    availableNow: z.boolean(),
    current: absenceSchema.nullable(),
    absences: list(absenceSchema),
  }),
});

// For myself (no userId), or for someone I may record for. 400 with field errors startDate /
// endDate, 403 not allowed, 409 overlaps another period.
export const createAbsence = defineEndpoint({
  method: "POST",
  path: "/api/availability/absences",
  body: z.object({
    userId: z.string().optional(),
    kind: z.union([
      z.literal(ABSENCE_KIND.Leave),
      z.literal(ABSENCE_KIND.OutOfOffice),
    ]),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the start date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the end date."),
    note: z.string().trim().max(200).optional(),
  }),
  response: absenceSchema,
});

// Cancels a future period; a started one ends early (it then ends yesterday).
export const cancelAbsence = defineEndpoint({
  method: "DELETE",
  path: "/api/availability/absences/{absenceId}",
  response: z.object({ message: z.string().nullable() }),
});

// Unit head, HOD of its department, Super Admin (403 otherwise).
export const getUnitAvailability = defineEndpoint({
  method: "GET",
  path: "/api/availability/units/{unitId}",
  response: unitAvailabilitySchema,
});

// HOD of the department, Super Admin.
export const getDepartmentAvailability = defineEndpoint({
  method: "GET",
  path: "/api/availability/departments/{departmentId}",
  response: z.array(unitAvailabilitySchema),
});
