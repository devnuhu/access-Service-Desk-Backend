import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** A category's template as its keepers edit it (placeholders not filled in; both null: none). */
const templateSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  subject: z.string().nullable(),
  descriptionHtml: z.string().nullable(),
});

/** Super Admin, the head of the category's unit, the Department Admin; others 403, unknown 404. */
export const getCategoryTemplate = defineEndpoint({
  method: "GET",
  path: "/api/categories/{categoryId}/template",
  response: templateSchema,
});

/**
 * Replaces the template; both empty removes it. Subject plain text up to 150 characters;
 * description rich text up to 5000 characters of text. Only the five placeholders are allowed:
 * 400 with field subject or descriptionHtml naming the word.
 */
export const saveCategoryTemplate = defineEndpoint({
  method: "PUT",
  path: "/api/categories/{categoryId}/template",
  body: z.object({
    subject: z.string().nullable(),
    descriptionHtml: z.string().nullable(),
  }),
  response: templateSchema,
});
