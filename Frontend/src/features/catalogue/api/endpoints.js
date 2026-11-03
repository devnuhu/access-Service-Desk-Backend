import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** defaultPriority: 1 Low, 2 Medium, 3 High, 4 Critical (TicketPriority). */
export const PRIORITY = Object.freeze({
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
});

export const PRIORITY_LABELS = Object.freeze({
  [PRIORITY.Low]: "Low",
  [PRIORITY.Medium]: "Medium",
  [PRIORITY.High]: "High",
  [PRIORITY.Critical]: "Critical",
});

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/**
 * What a requester chooses from when raising a ticket (FE-3): active departments with their active
 * categories. Categories have no extra form fields; the requester describes the request in the body.
 */
export const listCatalogue = defineEndpoint({
  method: "GET",
  path: "/api/catalogue/categories",
  response: z.array(
    z.object({
      departmentId: z.string(),
      code: z.string(),
      name: z.string(),
      categories: list(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          defaultPriority: z.number().int(),
        }),
      ),
    }),
  ),
});
