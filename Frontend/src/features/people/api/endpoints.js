import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/**
 * Active staff by name or login name, for copying colleagues (any signed-in person). Name, login
 * name and department only; at most 20. 400 (errors.query) under 2 characters.
 */
export const searchPeople = defineEndpoint({
  method: "GET",
  path: "/api/people/search",
  query: ["query"],
  response: z
    .array(
      z.object({
        userId: z.string(),
        userName: z.string(),
        fullName: z.string().nullable(),
        department: z.string().nullable(),
      }),
    )
    .nullable()
    .transform((items) => items ?? []),
});
