import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/**
 * One service level: hours to the first response and to resolution (working hours) for a priority,
 * either the default (global) or an override for a department or a category. A global row with
 * isDefault true is the built-in default: nothing is saved (id null).
 */
const rowSchema = z.object({
  id: z.string().nullable(),
  scope: z.string(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  priority: z.number().int(),
  responseHours: z.number().int(),
  resolutionHours: z.number().int(),
  isDefault: z.boolean(),
});

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/** Super Admin; anyone else 403. global: four rows, Critical to Low. */
export const getSlaPolicies = defineEndpoint({
  method: "GET",
  path: "/api/admin/sla-policies",
  response: z.object({ global: list(rowSchema), overrides: list(rowSchema) }),
});

/**
 * Adds or changes one level. 400 (as a message): response 1 to 720 hours, resolution 1 to 4000 and
 * not shorter than the response, the department or category missing; 404 unknown one.
 */
export const saveSlaPolicy = defineEndpoint({
  method: "PUT",
  path: "/api/admin/sla-policies",
  body: z.object({
    scope: z.enum(["global", "department", "category"]),
    departmentId: z.string().optional(),
    categoryId: z.string().optional(),
    priority: z.number().int().min(1).max(4),
    responseHours: z.number().int(),
    resolutionHours: z.number().int(),
  }),
  response: rowSchema,
});

/** Removes a saved level: the level above it (or the built-in default) applies again. */
export const deleteSlaPolicy = defineEndpoint({
  method: "DELETE",
  path: "/api/admin/sla-policies/{id}",
  response: z.object({ message: z.string() }),
});
