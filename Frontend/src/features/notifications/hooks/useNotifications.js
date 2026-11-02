import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../api/endpoints.js";

export const LATEST_SIZE = 10;
export const notificationKeys = {
  all: ["notifications"],
  latest: ["notifications", "latest"],
  unreadCount: ["notifications", "unread-count"],
};

/** The 10 latest notifications for the bell. */
export function useLatestNotifications({ enabled = true } = {}) {
  return useQuery({
    queryKey: notificationKeys.latest,
    queryFn: () =>
      request(listNotifications, { query: { page: 1, pageSize: LATEST_SIZE } }),
    enabled,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () => (await request(getUnreadCount)).count,
  });
}

/** Adds a pushed notification to the top of the cached list and bumps the count. */
export function addPushedNotification(queryClient, notification) {
  queryClient.setQueryData(notificationKeys.latest, (old) => {
    if (!old) return old;
    const rest = old.items.filter((item) => item.id !== notification.id);
    return {
      ...old,
      items: [notification, ...rest].slice(0, LATEST_SIZE),
      total: old.total + 1,
      unread: old.unread + (notification.isRead ? 0 : 1),
    };
  });
  if (!notification.isRead) {
    queryClient.setQueryData(
      notificationKeys.unreadCount,
      (count) => (count ?? 0) + 1,
    );
  }
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => request(markNotificationRead, { params: { id } }),
    onSuccess: (_, id) => {
      const latest = queryClient.getQueryData(notificationKeys.latest);
      const wasUnread = Boolean(
        latest?.items.some((item) => item.id === id && !item.isRead),
      );
      if (wasUnread) {
        queryClient.setQueryData(notificationKeys.latest, (old) => ({
          ...old,
          items: old.items.map((item) =>
            item.id === id
              ? { ...item, isRead: true, readAt: new Date().toISOString() }
              : item,
          ),
          unread: Math.max(0, old.unread - 1),
        }));
        queryClient.setQueryData(notificationKeys.unreadCount, (count) =>
          Math.max(0, (count ?? 1) - 1),
        );
      } else {
        queryClient.invalidateQueries({
          queryKey: notificationKeys.unreadCount,
        });
      }
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request(markAllNotificationsRead),
    onSuccess: () => {
      queryClient.setQueryData(notificationKeys.unreadCount, 0);
      queryClient.invalidateQueries({ queryKey: notificationKeys.latest });
    },
  });
}
