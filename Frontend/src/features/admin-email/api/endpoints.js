import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

// Never a key or password: only whether the key is set.
export const getEmailStatus = defineEndpoint({
  method: "GET",
  path: "/api/admin/email/status",
  response: z.object({
    provider: z.string().nullable(),
    infobip: z.object({
      baseUrl: z.string().nullable(),
      senderEmail: z.string().nullable(),
      senderName: z.string().nullable(),
      apiKeyConfigured: z.boolean(),
    }),
    smtp: z.object({
      host: z.string().nullable(),
      senderEmail: z.string().nullable(),
      signsIn: z.boolean(),
    }),
    notificationEmails: z.boolean(),
    ready: z.boolean(),
  }),
});

// Always 200 with { success, message }, unless the address is invalid (400).
export const sendTestEmail = defineEndpoint({
  method: "POST",
  path: "/api/admin/email/test",
  body: z.object({
    to: z.string().trim().email("Enter a valid email address"),
  }),
  response: z.object({ success: z.boolean(), message: z.string().nullable() }),
});
