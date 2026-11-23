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

/**
 * SlaLevel: how far an open ticket is through its time. Staff only; the API sends OnTrack for
 * requesters and for finished tickets, so the badge just renders what comes back.
 */
export const SLA_LEVEL = Object.freeze({
  OnTrack: 0,
  Warning: 1,
  Overdue: 2,
  FarPast: 3,
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
  /** SLA_LEVEL; always OnTrack for requesters and finished tickets. */
  slaLevel: z.number().int(),
  /**
   * Staff only: when the ticket's time runs out (working hours, Pending/Resolved time added back).
   * Null for requesters, for tickets not running (Pending, Resolved, Closed, Cancelled) and for
   * tickets raised before SLA tracking began. It moves; always read it, never compute it.
   */
  slaDueAt: z.string().nullable(),
  /**
   * For the signed-in person: someone else commented since they last opened it, or it was
   * assigned to them and never opened. Cleared by POST /api/tickets/{id}/read.
   */
  unread: z.boolean().default(false),
  /** Comments and files this person can see (a requester never counts internal notes). */
  commentCount: z.number().int().default(0),
  attachmentCount: z.number().int().default(0),
  lastCommentAt: z.string().nullable().default(null),
  /** The last comment this person can see is the requester's: waiting for staff to answer. */
  lastCommentByRequester: z.boolean().default(false),
  /** While Pending: who it waits on (PENDING_REASON: 1 requester, 2 third party). Null otherwise. */
  pendingReason: z.number().int().nullable().default(null),
  /** While Pending: when it went Pending (UTC). Null otherwise. */
  pendingSince: z.string().nullable().default(null),
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
  resolvedAt: z.string().nullable(),
  resolutionCode: z.number().int().nullable(),
  resolutionNote: z.string().nullable(),
  closedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  reopenCount: z.number().int(),
  /** Staff only: why it was escalated to the unit's head. */
  escalatedToHeadReason: z.string().nullable(),
  /** Staff only: when the SLA warning, the overdue alert and the HOD alert were sent. */
  slaWarnedAt: z.string().nullable(),
  slaBreachedAt: z.string().nullable(),
  slaL2At: z.string().nullable(),
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
 * Raise a ticket (multipart). The priority comes from impact and urgency through the priority matrix.
 * 400 answers errors.<field> for categoryId, locationId, impact, urgency, subject, descriptionHtml,
 * ccUserIds, files and requesterUserId (Super Admin only).
 */
export const createTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets",
  bodyType: "multipart",
  body: z.object({
    categoryId: z.string().min(1),
    locationId: z.string().min(1),
    impact: z.number().int().min(1).max(4),
    urgency: z.number().int().min(1).max(4),
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
 * slaBreached=true: open tickets that are overdue or far past (assigned and department views only).
 * escalated=true: tickets passed up to the head of the unit (escalatedToHeadAt set).
 * priority: 1 Low to 4 Critical. ageBand: 1 to 5, how long ago it was raised (../filters.js
 * AGE_BANDS, the bars of the unit chart); always sent with open=true, anything else is 400.
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
    "slaBreached",
    "escalated",
    "priority",
    "ageBand",
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

/**
 * Open tickets of a department (or one unit) by SLA level, each counted once at its highest level.
 * Staff of the department and Super Admin; anyone else 403.
 */
export const getSlaSummary = defineEndpoint({
  method: "GET",
  path: "/api/tickets/sla-summary",
  query: ["departmentId", "unitId"],
  response: z.object({
    open: z.number().int(),
    warning: z.number().int(),
    overdue: z.number().int(),
    farPast: z.number().int(),
    unassigned: z.number().int(),
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

/** TicketAssignment.method. Picked: a case worker took it from the unit pool. */
export const ASSIGNMENT_METHOD = Object.freeze({
  Auto: 1,
  Reassigned: 2,
  Picked: 3,
});

/**
 * The unit pool: New, unassigned tickets in units I work in (a member: the categories I handle; a
 * Head of Unit: every category of the unit). Oldest first, at most 200.
 */
export const listPool = defineEndpoint({
  method: "GET",
  path: "/api/pool",
  response: list(
    z.object({
      id: z.string(),
      reference: z.string(),
      unitId: z.string(),
      unitName: z.string(),
      categoryId: z.string(),
      categoryName: z.string(),
      priority: z.number().int(),
      createdAt: z.string(),
    }),
  ),
});

/**
 * Take a New ticket from the pool. 403 not in the unit or not mapped to the category, 400 I am
 * unavailable today, 409 already taken or no longer New, 404.
 */
export const pickTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/pick",
  response: z.object({ message: z.string() }),
});

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

/** I opened it: clears its unread marker in my lists. 404 for a ticket I cannot see. */
export const markTicketRead = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/read",
  response: messageSchema,
});

// Bulk: the same action on 1 to 50 tickets. Always 200 with one result per ticket (the single
// action's rules apply to each; status is what that action would have answered). 400 only when
// the list is empty or longer than 50.
const bulkResultSchema = z.object({
  total: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  items: list(
    z.object({
      ticketId: z.string(),
      reference: z.string().nullable(),
      ok: z.boolean(),
      status: z.number().int(),
      message: z.string(),
    }),
  ),
});
const ticketIds = z.array(z.string()).min(1).max(50);

export const bulkPick = defineEndpoint({
  method: "POST",
  path: "/api/tickets/bulk/pick",
  body: z.object({ ticketIds }),
  response: bulkResultSchema,
});

export const bulkAcknowledge = defineEndpoint({
  method: "POST",
  path: "/api/tickets/bulk/acknowledge",
  body: z.object({ ticketIds }),
  response: bulkResultSchema,
});

/** reason: 5 to 500 characters. */
export const bulkReassign = defineEndpoint({
  method: "POST",
  path: "/api/tickets/bulk/reassign",
  body: z.object({
    ticketIds,
    toUserId: z.string().min(1),
    reason: z.string(),
  }),
  response: bulkResultSchema,
});

/** code from the ticket's actions (resolutionCodes); note 10 to 4000 characters, posted on each. */
export const bulkResolve = defineEndpoint({
  method: "POST",
  path: "/api/tickets/bulk/resolve",
  body: z.object({ ticketIds, code: z.number().int(), note: z.string() }),
  response: bulkResultSchema,
});

// Saved views: a person's own list filters. filterJson is a JSON object the app defines (see
// ../views.js). 400 errors.name / errors.filterJson, 409 name already used, at most 30 each.
const savedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filterJson: z.string(),
  isFavourite: z.boolean(),
  createdAt: z.string(),
});

/** Favourites first, then by name. */
export const listSavedViews = defineEndpoint({
  method: "GET",
  path: "/api/views",
  response: list(savedViewSchema),
});

export const createSavedView = defineEndpoint({
  method: "POST",
  path: "/api/views",
  body: z.object({
    name: z.string(),
    filterJson: z.string(),
    isFavourite: z.boolean().optional(),
  }),
  response: savedViewSchema,
});

export const updateSavedView = defineEndpoint({
  method: "PATCH",
  path: "/api/views/{viewId}",
  body: z.object({
    name: z.string().optional(),
    filterJson: z.string().optional(),
    isFavourite: z.boolean().optional(),
  }),
  response: savedViewSchema,
});

export const deleteSavedView = defineEndpoint({
  method: "DELETE",
  path: "/api/views/{viewId}",
  response: messageSchema,
});

// Linked tickets (staff for the ticket; anyone else 404). relation, seen from this ticket:
// related, duplicateOf, hasDuplicate, mergedInto, hasMerged.
const linkSchema = z.object({
  id: z.string(),
  relation: z.string(),
  ticket: z.object({
    id: z.string(),
    reference: z.string(),
    /** Null when I am not staff for that other ticket: show the reference and status only. */
    subject: z.string().nullable(),
    status: z.number().int(),
  }),
  createdAt: z.string(),
  /** False for a merge: it cannot be undone here. */
  canRemove: z.boolean(),
});

export const listTicketLinks = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/links",
  response: list(linkSchema),
});

/** relation: related (default) or duplicateOf. 400 field reference/relation, 404 no such ticket I work on, 409 already linked. */
export const addTicketLink = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/links",
  body: z.object({ reference: z.string(), relation: z.string() }),
  response: linkSchema,
});

/** 400 for a merge. */
export const removeTicketLink = defineEndpoint({
  method: "DELETE",
  path: "/api/tickets/{ticketId}/links/{linkId}",
  response: messageSchema,
});

/**
 * Merge this ticket (the duplicate) into the one to keep: it closes for good, nothing is deleted.
 * copyRequester copies this ticket's requester on the kept one. 400 field targetReference/reason.
 */
export const mergeTicket = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/merge",
  body: z.object({
    targetReference: z.string(),
    reason: z.string(),
    copyRequester: z.boolean(),
  }),
  response: messageSchema,
});

/**
 * Can I change this ticket's priority (canChange; reason says why not), the priority, and for
 * staff the requester's answers (impact, urgency: null on older tickets and for everyone else).
 * 404: the ticket cannot be seen.
 */
export const getTicketPriority = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/priority",
  response: z.object({
    canChange: z.boolean(),
    reason: z.string().nullable().optional(),
    priority: z.number().int(),
    impact: z.number().int().nullable().optional(),
    urgency: z.number().int().nullable().optional(),
  }),
});

/**
 * Change an open ticket's priority with a reason (5 to 500 characters, kept as an internal note);
 * the service-level targets follow. 400 errors.priority / errors.reason; 403; 404; 409 changed at
 * the same moment.
 */
export const changeTicketPriority = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/priority",
  body: z.object({
    priority: z.number().int().min(1).max(4),
    reason: z.string().trim().min(5).max(500),
  }),
  response: z.object({ message: z.string() }),
});

// Tasks: the ticket's checklist. Staff of the ticket and Super Admin only; anyone else, the
// requester included, gets 404, so never call these for a requester.
const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Null: the ticket's assignee owns it. */
  assignee: personSchema.nullable(),
  /** yyyy-MM-dd (Lagos date) or null. */
  dueDate: z.string().nullable(),
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
  /** Who ticked it; null while open. */
  doneBy: personSchema.nullable(),
  /** Open and the due date has passed. */
  isOverdue: z.boolean(),
  createdAt: z.string(),
});

const taskBody = z.object({
  title: z.string(),
  assigneeUserId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

/** The tasks in the order added, how many are open and done, and canEdit (false once Resolved, Closed or Cancelled). */
export const listTicketTasks = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/tasks",
  response: z.object({
    items: list(taskSchema),
    open: z.number().int(),
    done: z.number().int(),
    canEdit: z.boolean(),
  }),
});

/** The owner picker: everyone active who works in the ticket's department. */
export const listTaskOwners = defineEndpoint({
  method: "GET",
  path: "/api/tickets/{ticketId}/tasks/owners",
  response: list(personSchema),
});

/**
 * title 3 to 200; at most 30 per ticket; assigneeUserId someone in the ticket's department (empty:
 * the ticket's assignee); dueDate yyyy-MM-dd. 400 errors.title / dueDate / assigneeUserId.
 */
export const addTicketTask = defineEndpoint({
  method: "POST",
  path: "/api/tickets/{ticketId}/tasks",
  body: taskBody,
  response: taskSchema,
});

/** Same rules as adding. */
export const updateTicketTask = defineEndpoint({
  method: "PUT",
  path: "/api/tickets/{ticketId}/tasks/{taskId}",
  body: taskBody,
  response: taskSchema,
});

export const setTicketTaskDone = defineEndpoint({
  method: "PUT",
  path: "/api/tickets/{ticketId}/tasks/{taskId}/done",
  body: z.object({ done: z.boolean() }),
  response: taskSchema,
});

export const removeTicketTask = defineEndpoint({
  method: "DELETE",
  path: "/api/tickets/{ticketId}/tasks/{taskId}",
  response: messageSchema,
});
