import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { readEnv } from "@/shared/lib/env";
import { NOTIFICATION_HUB_PATH } from "./endpoints.js";

/**
 * The live notification connection. It signs in with the HttpOnly cookie (withCredentials), never
 * with a token in the URL, and reconnects on its own after a network drop.
 */
export function createNotificationConnection() {
  return new HubConnectionBuilder()
    .withUrl(`${readEnv().apiBaseUrl}${NOTIFICATION_HUB_PATH}`, {
      withCredentials: true,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();
}
