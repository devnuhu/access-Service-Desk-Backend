import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** TicketStatus. Automatic assignment (Step 5) and the workflow actions (Step 6) move it on. */
export const STATUS = Object.freeze({
  New: 1,
  Assigned: 2,
  InProgress: 3,
  Pending: 4,
  Resolved: 5,
  Reopened: 6,
  Closed: 7,
  Cancelled: 8,
});

export const STATUS_LABELS = Object.freeze({
  [STATUS.New]: "New",
  [STATUS.Assigned]: "Assigned",
  [STATUS.InProgress]: "In progress",
  [STATUS.Pending]: "Pending",
  [STATUS.Resolved]: "Resolved",
  [STATUS.Reopened]: "Reopened",
  [STATUS.Closed]: "Closed",
  [STATUS.Cancelled]: "Cancelled",
});

/** Still being worked on: what "Open" means in the lists and on Home. */
export const OPEN_STATUSES = Object.freeze([
  STATUS.New,
  STATUS.Assigned,
  STATUS.InProgress,
  STATUS.Pending,
  STATUS.Reopened,
]);

const list = (schema) =>
  z
    .array(schema)
    .nullable()
    .transform((items) => items ?? []);

/** PersonDto: who raised, asked, was copied or is assigned. */
const personSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  fullName: z.string().nullable(),
});

const fileSchema = z.object({
  id: z.string(),
  commentId: z.string().nullable(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  uploadedBy: personSchema,
  uploadedAt: z.string(),
});

const commentSchema = z.object({
  id: z.string(),
  author: personSchema,
  bodyHtml: z.string(),
  isInternal: z.boolean(),
  createdAt: z.string(),
  attachments: list(fileSchema),
});

const listItemFields = {
  id: z.string(),
  reference: z.string(),
  subject: z.string(),
  departmentCode: z.string(),
  categoryName: z.string(),
  unitName: z.string(),
  locationName: z.string(),
  priority: z.number().int(),
  status: z.number().int(),
  requester: personSchema,
  assignee: personSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
};

const ticketSchema = z.object({
  ...listItemFields,
  departmentId: z.string(),
  departmentName: z.string(),
  categoryId: z.string(),
  unitId: z.string(),
  locationId: z.string(),
  requesterDepartment: z.string().nullable(),
  raisedBy: personSchema,
  descriptionHtml: z.string(),
  cc: list(personSchema),
  attachments: list(fileSchema),
  comments: list(commentSchema),
  isStaffView: z.boolean(),
  canComment: z.boolean(),
  canAddInternalNote: z.boolean(),
});

const file = z.instanceof(Blob);

/** Active locations and the one to pre-select (the person's last ticket; forUserId: Super Admin). */
export const listLocations = defineEndpoint({
  method: "GET",
  path: "/api/locations",
  query: ["forUserId"],
  response: z.object({
    locations: list(
      z.object({
        id: z.string(),
        name: z.string(),
        sortOrder: z.number(),
        isActive: z.boolean(),
      }),
    ),
    defaultLocationId: z.string().nullable(),
  }),
});

/**
 * Raise a ticket (multipart). 400 answers errors.<field> for categoryId, locationId, priority,
 * subject, descriptionHtml, ccUserIds, files and requesterUserId (Super Admin only).
 */
export const createTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets",
  bodyType: "multipart",
  body: z.object({
    categoryId: z.string().min(1),
    locationId: z.string().min(1),
    priority: z.number().int().optional(),
    subject: z.string(),
    descriptionHtml: z.string(),
    ccUserIds: z.array(z.string()).optional(),
    requesterUserId: z.string().optional(),
    files: z.array(file).optional(),
  }),
  response: z.object({
    id: z.string(),
    reference: z.string(),
    message: z.string(),
  }),
});

/** Open tickets in the same category from the last 7 days that mention the same RSA PIN. */
export const checkDuplicates = defineEndpoint({
  method: "POST",
  path: "/api/tickets/duplicate-check",
  body: z.object({
    categoryId: z.string(),
    subject: z.string(),
    descriptionHtml: z.string(),
  }),
  response: z.object({
    pinsFound: list(z.string()),
    matches: list(
      z.object({
        reference: z.string(),
        status: z.number().int(),
        createdAt: z.string(),
        isYours: z.boolean(),
      }),
    ),
  }),
});

/** view: mine (default), copied, assigned, department (with departmentId; optional unitId). */
export const listTickets = defineEndpoint({
  method: "GET",
  path: "/api/tickets",
  query: [
    "view",
    "departmentId",
    "unitId",
    "status",
    "search",
    "page",
    "pageSize",
  ],
  response: z.object({
    items: list(z.object(listItemFields)),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});

/** 404 for a ticket the person may not see, on purpose (references cannot be probed). */
export const getTicket = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}",
  response: ticketSchema,
});

export const getTicketByReference = defineEndpoint({
  method: "GET",
  path: "/api/tickets/by-reference/{reference}",
  response: ticketSchema,
});

/** A public reply or an internal note (department staff), with 0-6 files. 400 / 403 / 404 / 409. */
export const addComment = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/comments",
  bodyType: "multipart",
  body: z.object({
    bodyHtml: z.string(),
    isInternal: z.boolean(),
    files: z.array(file).optional(),
  }),
  response: commentSchema,
});

/** The file itself, always as a download (internal-note files: staff only). */
export const downloadAttachment = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/attachments/{attachmentId}",
  responseType: "blob",
});
