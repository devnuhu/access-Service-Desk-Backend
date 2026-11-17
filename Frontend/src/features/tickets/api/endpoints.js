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

/** TicketCommentDto.kind: typed by a person, or written by the system for an action. */
export const COMMENT_KIND = Object.freeze({ Comment: 0, Workflow: 1 });

/** GET /api/tickets sort: newest first (default), oldest assignment first, newest assignment first. */
export const TICKET_SORT = Object.freeze({
  Newest: "created",
  LongestWaiting: "assignedAt",
  RecentlyAssigned: "assignedAt_desc",
});

/** Who a Pending ticket is waiting on. */
export const PENDING_REASON = Object.freeze({ Requester: 1, ThirdParty: 2 });

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
  kind: z.number().int(),
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
  assignedAt: z.string().nullable(),
  /** The first answer to the requester (acknowledged, or the assignee's first public reply). */
  firstRespondedAt: z.string().nullable(),
  /** Staff only: when the assignee escalated it to the unit's head. */
  escalatedToHeadAt: z.string().nullable(),
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
  acknowledgedAt: z.string().nullable(),
  pendingReason: z.number().int().nullable(),
  pendingSince: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionCode: z.number().int().nullable(),
  resolutionNote: z.string().nullable(),
  closedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  reopenCount: z.number().int(),
  /** Staff only: why it was escalated to the unit's head. */
  escalatedToHeadReason: z.string().nullable(),
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

/**
 * view: mine (default), copied, assigned, department (needs departmentId). departmentId and unitId
 * narrow any view. open=true: New, Assigned, In progress, Pending, Reopened; open=false: the rest.
 */
export const listTickets = defineEndpoint({
  method: "GET",
  path: "/api/tickets",
  query: [
    "view",
    "departmentId",
    "unitId",
    "status",
    "open",
    "waitingToStart",
    "sort",
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

/** TicketAssignment.method. */
export const ASSIGNMENT_METHOD = Object.freeze({ Auto: 1, Reassigned: 2 });

/**
 * Whether I may reassign the ticket and to whom (department staff and Super Admin; a requester or
 * a copied colleague gets 403, anyone else 404). `reason` says why not when canReassign is false.
 */
export const getReassignOptions = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/reassign-options",
  response: z.object({
    canReassign: z.boolean(),
    reason: z.string().nullable(),
    candidates: list(
      z.object({
        userId: z.string(),
        userName: z.string(),
        fullName: z.string().nullable(),
        unitId: z.string(),
        unitName: z.string(),
        handlesCategory: z.boolean(),
        workload: z.number(),
        isCurrentAssignee: z.boolean(),
      }),
    ),
  }),
});

/** Reassign with a reason (5-500). 400 errors.reason / errors.toUserId, 403, 404, 409. */
export const reassignTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/reassign",
  body: z.object({ toUserId: z.string().min(1), reason: z.string() }),
  response: z.object({ message: z.string() }),
});

/** Assignment history, oldest first; Auto entries carry the workloads the engine compared. */
export const listAssignments = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/assignments",
  response: list(
    z.object({
      id: z.string(),
      at: z.string(),
      method: z.number().int(),
      reason: z.string(),
      from: personSchema.nullable(),
      to: personSchema,
      by: personSchema.nullable(),
      fromUnitName: z.string(),
      toUnitName: z.string(),
      scores: list(
        z.object({
          userId: z.string(),
          userName: z.string(),
          fullName: z.string().nullable(),
          workload: z.number(),
          openTickets: z.number(),
          lastAssignedAt: z.string().nullable(),
          chosen: z.boolean(),
        }),
      ),
    }),
  ),
});

const messageSchema = z.object({ message: z.string() });

/** What I may do with this ticket now, for anyone who can see it. The server decides; never guess. */
export const getTicketActions = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/actions",
  response: z.object({
    canAcknowledge: z.boolean(),
    canSetPending: z.boolean(),
    canResume: z.boolean(),
    canResolve: z.boolean(),
    canConfirm: z.boolean(),
    canReopen: z.boolean(),
    canCancel: z.boolean(),
    canEscalate: z.boolean(),
    resolutionCodes: list(z.object({ code: z.number(), label: z.string() })),
  }),
});

// Workflow: each answers { message }. 400 (errors.<field>, or the wrong status), 403, 404, 409.

export const acknowledgeTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/acknowledge",
  response: messageSchema,
});

export const setTicketPending = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/pending",
  body: z.object({ reason: z.number().int(), note: z.string() }),
  response: messageSchema,
});

export const resumeTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/resume",
  response: messageSchema,
});

export const resolveTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/resolve",
  body: z.object({ code: z.number().int(), note: z.string() }),
  response: messageSchema,
});

export const confirmTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/confirm",
  response: messageSchema,
});

export const reopenTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/reopen",
  body: z.object({ reason: z.string() }),
  response: messageSchema,
});

export const cancelTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/cancel",
  body: z.object({ reason: z.string() }),
  response: messageSchema,
});

/** The assignee asks the unit's head for help. reason: 5 to 1000 characters, kept as an internal note. */
export const escalateTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/escalate",
  body: z.object({ reason: z.string() }),
  response: messageSchema,
});
