import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const roles = z
  .array(z.string())
  .nullable()
  .transform((list) => list ?? []);

/** AdminUserDto: a person with every active role. */
const adminUserSchema = z.object({
  id: z.string(),
  userName: z.string().nullable(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  roles,
  isActive: z.boolean(),
  hasSignedIn: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Every admin change answers { message }; failures (400, 404, 409) do too. */
const messageSchema = z.object({ message: z.string() });

export const listUsers = defineEndpoint({
  method: "GET",
  path: "/api/admin/users",
  query: ["page", "pageSize", "search", "role"],
  response: z.object({
    items: z
      .array(adminUserSchema)
      .nullable()
      .transform((items) => items ?? []),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});

export const getUser = defineEndpoint({
  method: "GET",
  path: "/api/admin/users/{userId}",
  response: adminUserSchema,
});

export const listRoles = defineEndpoint({
  method: "GET",
  path: "/api/admin/roles",
  response: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
    }),
  ),
});

// 409 when the person already holds the role; 404 when the person or role is unknown.
export const assignRole = defineEndpoint({
  method: "POST",
  path: "/api/admin/users/{userId}/roles",
  body: z.object({ roleId: z.string().min(1, "Choose a role.") }),
  response: messageSchema,
});

// 400 for Requester and for the last Super Admin; 404 when not held.
export const removeRole = defineEndpoint({
  method: "DELETE",
  path: "/api/admin/users/{userId}/roles/{roleId}",
  response: messageSchema,
});

// 400 for yourself or the last Super Admin. Blocking ends the person's sessions.
export const setUserStatus = defineEndpoint({
  method: "PATCH",
  path: "/api/admin/users/{userId}/status",
  body: z.object({ isActive: z.boolean() }),
  response: messageSchema,
});

// Up to 20 people. 503 while the directory cannot be reached (or AD is not set up yet).
export const searchDirectory = defineEndpoint({
  method: "GET",
  path: "/api/directory/users/search",
  query: ["query"],
  response: z.array(
    z.object({
      distinguishedName: z.string().nullable(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      jobTitle: z.string().nullable(),
      department: z.string().nullable(),
      samAccountName: z.string().nullable(),
    }),
  ),
});

// Makes a local account (Requester) so roles can be given before the first sign-in.
export const ensureDirectoryUser = defineEndpoint({
  method: "POST",
  path: "/api/directory/users/ensure",
  body: z.object({ samAccountName: z.string().min(1) }),
  response: z.object({
    userId: z.string(),
    userName: z.string().nullable(),
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    department: z.string().nullable(),
    created: z.boolean(),
    roles,
  }),
});
