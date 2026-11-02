import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** NotificationType: 0 Info, 1 Success, 2 Warning, 3 ActionRequired. */
export const NOTIFICATION_TYPE = Object.freeze({
  Info: 0,
  Success: 1,
  Warning: 2,
  ActionRequired: 3,
});

/** NotificationCategory: 0 System, 1 Ticket, 2 Assignment, 3 Sla, 4 Escalation, 5 Report. */
export const NOTIFICATION_CATEGORY = Object.freeze({
  System: 0,
  Ticket: 1,
  Assignment: 2,
  Sla: 3,
  Escalation: 4,
  Report: 5,
});

/** One InAppNotificationDto: a list item, and what the hub pushes in ReceiveNotification. */
export const notificationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  message: z.string().nullable(),
  type: z.number().int(),
  category: z.number().int(),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().nullable(),
  deepLinkUrl: z.string().nullable(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  isActionRequired: z.boolean(),
});

export const listNotifications = defineEndpoint({
  method: "GET",
  path: "/api/notifications",
  query: ["page", "pageSize", "unreadOnly"],
  response: z.object({
    items: z
      .array(notificationSchema)
      .nullable()
      .transform((items) => items ?? []),
    total: z.number(),
    unread: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});

export const getUnreadCount = defineEndpoint({
  method: "GET",
  path: "/api/notifications/unread-count",
  response: z.object({ count: z.number() }),
});

// 204 No Content.
export const markNotificationRead = defineEndpoint({
  method: "PATCH",
  path: "/api/notifications/{id}/read",
});

export const markAllNotificationsRead = defineEndpoint({
  method: "PATCH",
  path: "/api/notifications/read-all",
  response: z.object({ marked: z.number() }),
});

/** SignalR hub (not an /api route). Server -> client: ReceiveNotification(notification). */
export const NOTIFICATION_HUB_PATH = "/hubs/notifications";
