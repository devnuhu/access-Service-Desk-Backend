import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

const priority = z.number().int().min(1).max(4);

/** CategoryAdminDto: a category as the Super Admin manages it. */
const categorySchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  departmentName: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  timelineHours: z.number().int(),
  defaultPriority: z.number().int(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Mapped case workers who are active members of the unit with an active account. */
  eligibleCount: z.number().int(),
  /** An active category with fewer than two eligible case workers. */
  needsCover: z.boolean(),
});

/** CategoryCoverDto: an active category with fewer than two eligible case workers. */
const coverSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  eligibleCount: z.number().int(),
});

const messageSchema = z.object({ message: z.string().nullable() });

const nameSchema = z
  .string()
  .trim()
  .min(2, "Use 2 to 100 characters.")
  .max(100, "Use 2 to 100 characters.");
const descriptionSchema = z.string().trim().max(300, "At most 300 characters.");
const timelineSchema = z
  .number({ error: "Enter a number of business hours." })
  .int("Use whole hours.")
  .min(1, "Between 1 and 720 business hours.")
  .max(720, "Between 1 and 720 business hours.");

export const listCategories = defineEndpoint({
  method: "GET",
  path: "/api/admin/categories",
  query: ["departmentId"],
  response: z.array(categorySchema),
});

// 400 errors.unitId when no unit is chosen; 409 the name is taken in the department.
export const createCategory = defineEndpoint({
  method: "POST",
  path: "/api/admin/categories",
  body: z.object({
    unitId: z.string().min(1, "Choose a unit."),
    name: nameSchema,
    description: descriptionSchema.optional(),
    timelineHours: timelineSchema,
    defaultPriority: priority,
  }),
  response: categorySchema,
});

// Leave a field out to keep it; an empty description clears it. The message says what else
// happened ("Moved to Refund. 3 case worker mappings were removed. …").
export const updateCategory = defineEndpoint({
  method: "PATCH",
  path: "/api/admin/categories/{categoryId}",
  body: z.object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    unitId: z.string().optional(),
    timelineHours: timelineSchema.optional(),
    defaultPriority: priority.optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  }),
  response: messageSchema,
});

export const listCoverWarnings = defineEndpoint({
  method: "GET",
  path: "/api/admin/categories/cover-warnings",
  response: z.array(coverSchema),
});

/** The skills matrix of one unit: its categories (columns), its members (rows), warnings. */
export const getUnitSkills = defineEndpoint({
  method: "GET",
  path: "/api/admin/units/{unitId}/skills",
  response: z.object({
    unitId: z.string(),
    unitName: z.string(),
    categories: list(
      z.object({
        id: z.string(),
        name: z.string(),
        isActive: z.boolean(),
        eligibleCount: z.number().int(),
      }),
    ),
    members: list(
      z.object({
        userId: z.string(),
        userName: z.string(),
        fullName: z.string().nullable(),
        staffCategory: z.number().int(),
        accountActive: z.boolean(),
        categoryIds: list(z.string()),
      }),
    ),
    warnings: list(coverSchema),
  }),
});

// The full set for that person in that unit ([] clears). The message ends with "Fewer than two
// case workers handle: …" when cover is short. 400 for a switched-off category or a blocked person.
export const setUnitSkills = defineEndpoint({
  method: "PUT",
  path: "/api/admin/units/{unitId}/skills/{userId}",
  body: z.object({ categoryIds: z.array(z.string()) }),
  response: messageSchema,
});
