import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SESSION_KEY } from "@/features/auth";
import { ORG_ME_KEY } from "@/features/org";
import { refreshSessionNow } from "@/shared/lib/http";
import { useToast } from "@/shared/ui";
import { createNotificationConnection } from "../api/hub.js";
import { notificationSchema } from "../api/endpoints.js";
import { addPushedNotification, notificationKeys } from "./useNotifications.js";

/** Query keys refreshed by a pushed notification, by its relatedEntityType. */
export const REFRESH_BY_ENTITY = {
  // Roles or place in the organisation changed: roles and the menu update without signing out.
  User: [SESSION_KEY, ORG_ME_KEY],
  // Someone's leave changed: the availability views refetch.
  Absence: [["availability"]],
};

/**
 * Pushed changes that also change the roles inside the access token. The token is renewed first
 * (through the client's one shared refresh), so pages and API calls that check the token's roles
 * follow at once, then the queries above refetch.
 */
const RENEW_TOKEN_FOR = new Set(["User"]);

/**
 * Live notifications while the shell is shown (signed in). The connection stops when the shell
 * unmounts, which is what sign-out does.
 */
export default function useLiveNotifications() {
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const connection = createNotificationConnection();
    let stopped = false;

    connection.on("ReceiveNotification", (payload) => {
      const parsed = notificationSchema.safeParse(payload);
      if (!parsed.success) {
        queryClient.invalidateQueries({ queryKey: notificationKeys.all });
        return;
      }
      const notification = parsed.data;
      addPushedNotification(queryClient, notification);
      const entity = notification.relatedEntityType;
      const refetch = () => {
        if (stopped) return;
        for (const queryKey of REFRESH_BY_ENTITY[entity] ?? []) {
          queryClient.invalidateQueries({ queryKey });
        }
      };
      if (RENEW_TOKEN_FOR.has(entity)) {
        refreshSessionNow().then(refetch, refetch);
      } else {
        refetch();
      }
      const show = notification.isActionRequired ? toast.action : toast.info;
      show(notification.message ?? "", {
        title: notification.title ?? "New notification",
      });
    });

    // After a reconnect, anything pushed while offline is fetched.
    connection.onreconnected?.(() => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    });

    connection.start().catch((error) => {
      if (!stopped)
        console.warn("Live notifications are off:", error?.message ?? error);
    });

    return () => {
      stopped = true;
      connection.stop().catch(() => {});
    };
  }, [queryClient, toast]);
}
