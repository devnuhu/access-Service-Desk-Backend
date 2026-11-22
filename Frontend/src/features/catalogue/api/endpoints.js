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

/** The categories the signed-in person handles, per unit (read-only). */
export const listMyCategories = defineEndpoint({
  method: "GET",
  path: "/api/catalogue/mine",
  response: list(
    z.object({
      unitId: z.string(),
      unitName: z.string(),
      departmentName: z.string(),
      categories: list(
        z.object({
          id: z.string(),
          name: z.string(),
          isActive: z.boolean(),
        }),
      ),
    }),
  ),
});

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

/**
 * Suggested subject and description per category, for the raise form: only categories a requester
 * can choose that have a template, placeholders already filled in for the signed-in person.
 */
export const listCatalogueTemplates = defineEndpoint({
  method: "GET",
  path: "/api/catalogue/templates",
  response: list(
    z.object({
      categoryId: z.string(),
      subject: z.string().nullable(),
      descriptionHtml: z.string().nullable(),
    }),
  ),
});

/** The request form's two questions, used when the matrix cannot be loaded. */
export const IMPACT_FALLBACK = [
  { value: 1, label: "Just me", description: "" },
  { value: 2, label: "My team", description: "" },
  { value: 3, label: "My department", description: "" },
  { value: 4, label: "The whole company", description: "" },
];
export const URGENCY_FALLBACK = [
  { value: 1, label: "It can wait", description: "" },
  { value: 2, label: "Soon", description: "" },
  { value: 3, label: "Urgent", description: "" },
  { value: 4, label: "I cannot work", description: "" },
];

/** The built-in priority of a cell: impact + urgency, 2-3 Low, 4-5 Medium, 6-7 High, 8 Critical. */
export function defaultPriorityFor(impact, urgency) {
  const sum = impact + urgency;
  if (sum >= 8) return PRIORITY.Critical;
  if (sum >= 6) return PRIORITY.High;
  if (sum >= 4) return PRIORITY.Medium;
  return PRIORITY.Low;
}

/** The priority the matrix gives an impact and urgency pair (null when not both chosen or not found). */
export function matrixPriority(matrix, impact, urgency) {
  if (!matrix || !impact || !urgency) return null;
  return (
    matrix.cells.find(
      (cell) => cell.impact === impact && cell.urgency === urgency,
    )?.priority ?? null
  );
}

const choice = z.looseObject({
  value: z.number().int(),
  label: z.string(),
  description: z.string().nullable().optional(),
});

/** A priority matrix: the two questions with their wording, and all 16 cells (isDefault: not edited). */
export const priorityMatrixSchema = z.object({
  impacts: list(choice),
  urgencies: list(choice),
  cells: list(
    z.object({
      impact: z.number().int(),
      urgency: z.number().int(),
      priority: z.number().int(),
      isDefault: z.boolean(),
    }),
  ),
});

/** The request form's questions and the priority for every answer pair (anyone signed in). */
export const getPriorityMatrix = defineEndpoint({
  method: "GET",
  path: "/api/priority-matrix",
  response: priorityMatrixSchema,
});
