import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  isActive: z.boolean(),
});

/** Every location, switched-off ones included (Super Admin). */
export const listAdminLocations = defineEndpoint({
  method: "GET",
  path: "/api/admin/locations",
  response: z
    .array(locationSchema)
    .nullable()
    .transform((items) => items ?? []),
});

export const createLocation = defineEndpoint({
  method: "POST",
  path: "/api/admin/locations",
  body: z.object({
    name: z.string().trim().min(1, "Enter a name.").max(100),
    sortOrder: z.number().int().optional(),
  }),
  response: locationSchema,
});

/** Rename, reorder or switch on/off. 400 "At least one location must stay on". */
export const updateLocation = defineEndpoint({
  method: "PATCH",
  path: "/api/admin/locations/{locationId}",
  body: z.object({
    name: z.string().trim().min(1, "Enter a name.").max(100).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
  response: z.object({ message: z.string() }),
});
