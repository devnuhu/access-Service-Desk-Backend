import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** staffCategory: 1 Employee, 2 Head of Unit. */
export const STAFF_CATEGORY = Object.freeze({ Employee: 1, HeadOfUnit: 2 });

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/** PersonRefDto, or null when nobody holds the post. */
const person = z
  .object({
    userId: z.string(),
    userName: z.string().nullable(),
    fullName: z.string().nullable(),
    email: z.string().nullable(),
  })
  .nullable();

const unitSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  code: z.string().nullable(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  head: person,
  memberCount: z.number(),
});

const departmentSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  hod: person,
  admin: person,
  units: list(unitSchema),
});

const messageSchema = z.object({ message: z.string().nullable() });

/** 2-10 capital letters, digits or dashes; the ticket reference prefix (cannot change later). */
const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9-]{2,10}$/, "Use 2 to 10 capital letters, digits or dashes.");
const nameSchema = z.string().trim().min(1, "Enter a name.").max(100);
const orgItemSchema = z.object({ code: codeSchema, name: nameSchema });

/** Rename and/or switch on or off. */
const updateSchema = z.object({
  name: nameSchema.optional(),
  isActive: z.boolean().optional(),
});

/** Sets a post, or clears it with null. */
const setPersonSchema = z.object({ userId: z.string().nullable() });

export const listAdminDepartments = defineEndpoint({
  method: "GET",
  path: "/api/admin/departments",
  response: z.array(departmentSchema),
});

// 400 invalid code or name; 409 code or name already used.
export const createDepartment = defineEndpoint({
  method: "POST",
  path: "/api/admin/departments",
  body: orgItemSchema,
  response: departmentSchema,
});

// 400 "Switch off its units first."
export const updateDepartment = defineEndpoint({
  method: "PATCH",
  path: "/api/admin/departments/{departmentId}",
  body: updateSchema,
  response: messageSchema,
});

// The HOD cannot be a member of a unit in the department (400).
export const setDepartmentHod = defineEndpoint({
  method: "PUT",
  path: "/api/admin/departments/{departmentId}/hod",
  body: setPersonSchema,
  response: messageSchema,
});

// The Department Admin must head an active unit in that department (400).
export const setDepartmentAdmin = defineEndpoint({
  method: "PUT",
  path: "/api/admin/departments/{departmentId}/admin",
  body: setPersonSchema,
  response: messageSchema,
});

export const createUnit = defineEndpoint({
  method: "POST",
  path: "/api/admin/departments/{departmentId}/units",
  body: orgItemSchema,
  response: unitSchema,
});

// 400 "Remove its members (and its head) first."
export const updateUnit = defineEndpoint({
  method: "PATCH",
  path: "/api/admin/units/{unitId}",
  body: updateSchema,
  response: messageSchema,
});

// The head is added as a member; the previous head stays as a case worker.
export const setUnitHead = defineEndpoint({
  method: "PUT",
  path: "/api/admin/units/{unitId}/head",
  body: setPersonSchema,
  response: messageSchema,
});

export const listUnitMembers = defineEndpoint({
  method: "GET",
  path: "/api/admin/units/{unitId}/members",
  response: z.array(
    z.object({
      userId: z.string(),
      userName: z.string().nullable(),
      fullName: z.string().nullable(),
      email: z.string().nullable(),
      staffNo: z.string().nullable(),
      staffCategory: z.number().int(),
      isHead: z.boolean(),
      accountActive: z.boolean(),
      joinedAt: z.string(),
      lastAssignedAt: z.string().nullable(),
    }),
  ),
});

// 409 already in a unit of this department; 400 for the department's HOD.
export const addUnitMember = defineEndpoint({
  method: "POST",
  path: "/api/admin/units/{unitId}/members",
  body: z.object({
    userId: z.string().min(1, "Choose a person."),
    staffNo: z.string().trim().max(30).optional(),
  }),
  response: messageSchema,
});

// 400 for the head (change the head first).
export const removeUnitMember = defineEndpoint({
  method: "DELETE",
  path: "/api/admin/units/{unitId}/members/{userId}",
  response: messageSchema,
});
