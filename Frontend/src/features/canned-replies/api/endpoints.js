import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** A reply as its keepers see it (placeholders not filled in). unitId null: shared by every unit. */
const replySchema = z.object({
  id: z.string(),
  unitId: z.string().nullable(),
  unitName: z.string().nullable(),
  isShared: z.boolean(),
  title: z.string(),
  bodyHtml: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const replyList = z
  .array(replySchema)
  .nullable()
  .transform((items) => items ?? []);

/** Title 2-100 characters; body rich text. 400 errors.title / errors.bodyHtml, 409 title already used. */
const saveBody = z.object({
  title: z.string().trim().min(2, "Use 2 to 100 characters.").max(100),
  bodyHtml: z.string().min(1, "Write the reply."),
});

/** Placeholders a reply may use ({{requester.name}} …) and what each becomes. Any signed-in person. */
export const listPlaceholders = defineEndpoint({
  method: "GET",
  path: "/api/canned-replies/placeholders",
  response: z.array(z.object({ token: z.string(), description: z.string() })),
});

/**
 * Replies for one ticket, ready to use: its unit's first, then the shared ones, placeholders filled
 * in for this ticket and the signed-in person. Staff for the ticket and Super Admin; 404 anyone else.
 */
export const listTicketReplies = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/canned-replies",
  response: z
    .array(
      z.object({
        id: z.string(),
        isShared: z.boolean(),
        title: z.string(),
        bodyHtml: z.string(),
      }),
    )
    .nullable()
    .transform((items) => items ?? []),
});

/** A unit's library: its head, the Department Admin, Super Admin (403 anyone else). */
export const listUnitReplies = defineEndpoint({
  method: "GET",
  path: "/api/units/{unitId}/canned-replies",
  response: replyList,
});

export const createUnitReply = defineEndpoint({
  method: "POST",
  path: "/api/units/{unitId}/canned-replies",
  body: saveBody,
  response: replySchema,
});

/** The shared library (Super Admin). */
export const listSharedReplies = defineEndpoint({
  method: "GET",
  path: "/api/admin/canned-replies",
  response: replyList,
});

export const createSharedReply = defineEndpoint({
  method: "POST",
  path: "/api/admin/canned-replies",
  body: saveBody,
  response: replySchema,
});

/** Change the title and/or the text (unit reply: its keepers; shared: Super Admin). */
export const updateReply = defineEndpoint({
  method: "PATCH",
  path: "/api/canned-replies/{replyId}",
  body: saveBody.partial(),
  response: replySchema,
});

export const deleteReply = defineEndpoint({
  method: "DELETE",
  path: "/api/canned-replies/{replyId}",
  response: z.object({ message: z.string() }),
});
