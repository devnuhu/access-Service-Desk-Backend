import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

const holidaySchema = z.object({
  // null for a holiday set in the server settings (fromConfig): it cannot be removed here.
  id: z.string().nullable(),
  date: z.string(),
  name: z.string(),
  fromConfig: z.boolean(),
});

/** Company holidays, oldest first; ?year= for one year (Super Admin). */
export const listHolidays = defineEndpoint({
  method: "GET",
  path: "/api/admin/holidays",
  query: ["year"],
  response: z
    .array(holidaySchema)
    .nullable()
    .transform((items) => items ?? []),
});

/** 400: name 2-100 characters, year 2000-2100. 409: that date is already a holiday. */
export const createHoliday = defineEndpoint({
  method: "POST",
  path: "/api/admin/holidays",
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    name: z.string().trim().min(2, "Use 2 to 100 characters.").max(100),
  }),
  response: holidaySchema,
});

/** 404 when it is already gone. */
export const deleteHoliday = defineEndpoint({
  method: "DELETE",
  path: "/api/admin/holidays/{holidayId}",
  response: z.object({ message: z.string() }),
});
