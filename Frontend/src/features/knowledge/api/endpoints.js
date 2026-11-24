import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** Help articles written by each department's staff (step "knowledge base"). Every call needs sign-in. */

/** Article.status as the API spells it; the manage filter sends the lower-case form. */
export const KB_STATUS = Object.freeze({
  Draft: "Draft",
  Published: "Published",
});

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

const refSchema = z.object({ id: z.string(), name: z.string() });

const personSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  fullName: z.string().nullable(),
});

const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  department: refSchema,
  category: refSchema.nullable(),
  status: z.string(),
  updatedAt: z.string(),
  yes: z.number().int(),
  no: z.number().int(),
});

const pageSchema = z.object({
  items: list(itemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Matches per department, ignoring the department filter: the filter chips. */
  departments: list(
    z.object({ id: z.string(), name: z.string(), count: z.number().int() }),
  ),
});

const LIST_QUERY = ["search", "departmentId", "categoryId", "page", "pageSize"];

/** Published articles (everyone signed in). pageSize at most 50. */
export const listArticles = defineEndpoint({
  method: "GET",
  path: "/api/kb",
  query: LIST_QUERY,
  response: pageSchema,
});

/** Drafts and published articles of the departments I write for (empty for a requester). status: draft or published. */
export const listManagedArticles = defineEndpoint({
  method: "GET",
  path: "/api/kb/manage",
  query: [...LIST_QUERY, "status"],
  response: pageSchema,
});

/** The departments I may write for, their categories, and whether I publish there. Empty: no writing screens. */
export const getKbOptions = defineEndpoint({
  method: "GET",
  path: "/api/kb/options",
  response: list(
    z.object({
      id: z.string(),
      name: z.string(),
      canPublish: z.boolean(),
      categories: list(refSchema),
    }),
  ),
});

/** Up to 3 published articles that may answer the request being raised. */
export const suggestArticles = defineEndpoint({
  method: "GET",
  path: "/api/kb/suggest",
  query: ["categoryId", "text"],
  response: list(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      departmentName: z.string(),
    }),
  ),
});

const articleSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  /** Cleaned by the server; shown only through RichTextView. */
  bodyHtml: z.string(),
  department: refSchema,
  category: refSchema.nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  author: personSchema.nullable(),
  yes: z.number().int(),
  no: z.number().int(),
  /** My answer to "Was this helpful?": true, false or null. */
  myVote: z.boolean().nullable(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  canDelete: z.boolean(),
});

/** One article. A draft is 404 for anyone outside its department. */
export const getArticle = defineEndpoint({
  method: "GET",
  path: "/api/kb/{id}",
  response: articleSchema,
});

const articleBody = z.object({
  departmentId: z.string(),
  categoryId: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  bodyHtml: z.string(),
});

/** Creates a draft. title 5 to 200 (unique in the department), summary 10 to 500, body 20+ characters of text. 400 errors.title / summary / bodyHtml / categoryId. */
export const createArticle = defineEndpoint({
  method: "POST",
  path: "/api/kb",
  body: articleBody,
  response: articleSchema,
});

/** Same rules; departmentId is ignored (an article cannot move). */
export const updateArticle = defineEndpoint({
  method: "PUT",
  path: "/api/kb/{id}",
  body: articleBody,
  response: articleSchema,
});

/** 403 for staff who are not publishers. */
export const publishArticle = defineEndpoint({
  method: "POST",
  path: "/api/kb/{id}/publish",
  response: articleSchema,
});

export const unpublishArticle = defineEndpoint({
  method: "POST",
  path: "/api/kb/{id}/unpublish",
  response: articleSchema,
});

export const deleteArticle = defineEndpoint({
  method: "DELETE",
  path: "/api/kb/{id}",
  response: z.object({ message: z.string() }),
});

/** One answer per person; answering again changes it. Published articles only. */
export const voteArticle = defineEndpoint({
  method: "POST",
  path: "/api/kb/{id}/vote",
  body: z.object({ helpful: z.boolean() }),
  response: z.object({
    yes: z.number().int(),
    no: z.number().int(),
    myVote: z.boolean().nullable(),
  }),
});
