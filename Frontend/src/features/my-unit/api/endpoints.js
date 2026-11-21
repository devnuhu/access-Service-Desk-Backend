import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/*
 * A unit's own tools ("My unit"). Reading: the unit's head, its department's HOD and Department
 * Admin, Super Admin; changing skills: not the HOD. Anyone else 403, an unknown unit 404.
 */

/** The unit's categories (read only here: the Super Admin creates and edits them). */
export const listUnitCategories = defineEndpoint({
  method: "GET",
  path: "/api/units/{unitId}/categories",
  response: list(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      timelineHours: z.number().int(),
      defaultPriority: z.number().int(),
      isActive: z.boolean(),
      eligibleCount: z.number().int(),
      needsCover: z.boolean(),
    }),
  ),
});

/** The unit's members (the head included). */
export const listUnitTeam = defineEndpoint({
  method: "GET",
  path: "/api/units/{unitId}/team",
  response: list(
    z.object({
      userId: z.string(),
      userName: z.string(),
      fullName: z.string().nullable(),
      email: z.string().nullable(),
      staffNo: z.string().nullable(),
      isHead: z.boolean(),
      accountActive: z.boolean(),
      joinedAt: z.string(),
      lastAssignedAt: z.string().nullable(),
    }),
  ),
});

const coverSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  unitId: z.string(),
  unitName: z.string(),
  eligibleCount: z.number().int(),
});

/** Who handles which of the unit's categories, and the categories short of cover. */
export const getUnitSkills = defineEndpoint({
  method: "GET",
  path: "/api/units/{unitId}/skills",
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

/**
 * One member's whole set of the unit's categories ([] clears). The message names the categories
 * left with fewer than two people. 400 switched-off category or blocked person, 403 the HOD.
 */
export const setMemberSkills = defineEndpoint({
  method: "PUT",
  path: "/api/units/{unitId}/skills/{userId}",
  body: z.object({ categoryIds: z.array(z.string()) }),
  response: z.object({ message: z.string().nullable() }),
});
