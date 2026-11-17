import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/**
 * The departments and units the signed-in person heads, deputises, works in or oversees (HOD).
 * The module menu is built from this, never from a hard-coded department (rule 14).
 */
export const getMyOrganisation = defineEndpoint({
  method: "GET",
  path: "/api/org/me",
  response: z.object({
    departments: list(
      z.object({
        id: z.string(),
        code: z.string().nullable(),
        name: z.string().nullable(),
        isHod: z.boolean(),
        /** The department's Admin: sees and reassigns across it, like the HOD. */
        isAdmin: z.boolean(),
        units: list(
          z.object({
            id: z.string(),
            code: z.string().nullable(),
            name: z.string().nullable(),
            isHead: z.boolean(),
            isDeputy: z.boolean(),
            isMember: z.boolean(),
          }),
        ),
      }),
    ),
  }),
});

/** Active departments with their active units (names only). */
export const listOrgDepartments = defineEndpoint({
  method: "GET",
  path: "/api/org/departments",
  response: z.array(
    z.object({
      id: z.string(),
      code: z.string().nullable(),
      name: z.string().nullable(),
      units: list(
        z.object({
          id: z.string(),
          code: z.string().nullable(),
          name: z.string().nullable(),
        }),
      ),
    }),
  ),
});
