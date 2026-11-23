import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** Open tickets counted once at their highest level: warning, overdue (past due) or far past. */
const levels = {
  open: z.number().int(),
  waitingToStart: z.number().int(),
  warning: z.number().int(),
  overdue: z.number().int(),
  farPast: z.number().int(),
  /** Open tickets whose first-response time (4 working hours from assignment) ran out unanswered. */
  responseOverdue: z.number().int().default(0),
};

const overviewCounts = {
  ...levels,
  unassigned: z.number().int(),
  escalated: z.number().int(),
};

/**
 * The home screen's counts in one call (any signed-in person). `mine`: tickets assigned to me, and
 * the ones I raised. `overview`: the units I lead (null when I lead none). Levels trail by a few
 * minutes; generatedAt says when.
 */
export const getDashboardSummary = defineEndpoint({
  method: "GET",
  path: "/api/dashboard/summary",
  response: z.object({
    generatedAt: z.string(),
    mine: z.object({
      ...levels,
      raisedOpen: z.number().int(),
      toConfirm: z.number().int(),
      /** My requests that are Pending because the case worker waits for my reply. */
      waitingOnMe: z.number().int().default(0),
    }),
    overview: z
      .object({
        total: z.object(overviewCounts),
        units: z
          .array(
            z.object({
              ...overviewCounts,
              unitId: z.string(),
              unitName: z.string(),
              departmentId: z.string(),
              departmentName: z.string(),
            }),
          )
          .nullable()
          .transform((units) => units ?? []),
      })
      .nullable(),
  }),
});

const ticketItem = z.object({
  ticketId: z.string(),
  reference: z.string(),
  categoryName: z.string(),
  assigneeName: z.string().nullable(),
  level: z.string(),
  since: z.string(),
  note: z.string().nullable().optional(),
});

/**
 * One unit's dashboard (its head, the department's HOD or Department Admin, Super Admin; 403 anyone
 * else, 404 unknown unit). Pool by category, team workload and leave, categories and cover,
 * escalations to the head (`since` = when it was passed up, `note` = why) and tickets past their
 * deadline (`since` = when the ticket was raised; level "overdue" or "farPast", far past first).
 */
export const getUnitDashboard = defineEndpoint({
  method: "GET",
  path: "/api/dashboard/unit/{unitId}",
  response: z.object({
    generatedAt: z.string(),
    unitId: z.string(),
    unitName: z.string(),
    departmentId: z.string(),
    departmentName: z.string(),
    counts: z.object(overviewCounts),
    pool: z.array(
      z.object({
        categoryId: z.string(),
        categoryName: z.string(),
        waiting: z.number().int(),
        oldestWaitingAt: z.string(),
      }),
    ),
    team: z.array(
      z.object({
        userId: z.string(),
        userName: z.string(),
        fullName: z.string().nullable(),
        isHead: z.boolean(),
        openTickets: z.number().int(),
        waitingToStart: z.number().int(),
        warning: z.number().int(),
        overdue: z.number().int(),
        farPast: z.number().int(),
        /** First response: unanswered past the target now; missed and met share over 30 days. */
        responseOverdue: z.number().int().default(0),
        responseMissed: z.number().int().default(0),
        responseMetPercent: z.number().nullable().default(null),
        onLeave: z.boolean(),
        leaveUntil: z.string().nullable(),
      }),
    ),
    categories: z.array(
      z.object({
        categoryId: z.string(),
        categoryName: z.string(),
        isActive: z.boolean(),
        eligibleCount: z.number().int(),
        openTickets: z.number().int(),
        needsCover: z.boolean(),
      }),
    ),
    escalated: z.array(ticketItem),
    attention: z.array(ticketItem),
  }),
});
