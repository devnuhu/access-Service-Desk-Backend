import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/ui";
import { createNotificationConnection } from "../api/hub.js";
import { notificationSchema } from "../api/endpoints.js";
import { addPushedNotification, notificationKeys } from "./useNotifications.js";

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
