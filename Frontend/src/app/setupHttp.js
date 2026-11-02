import { endSession, fetchCsrfToken, refreshSession } from "@/features/auth";
import { configureHttp, createHttpClient } from "@/shared/lib/http";
import { readEnv } from "@/shared/lib/env";

/**
 * Creates the one HTTP client. A 401 refreshes the session once (shared promise) and retries; if
 * that fails the session is cleared from the query cache and the route guards send the person to
 * /login?next=<current page>. A "Security check failed" 403 gets a new CSRF token and retries once.
 *
 * @param {import("@tanstack/react-query").QueryClient} queryClient
 */
export function setupHttp(queryClient) {
  configureHttp(
    createHttpClient({
      baseURL: readEnv().apiBaseUrl,
      refreshSession,
      fetchCsrfToken,
      onUnauthorized: () => endSession(queryClient),
    }),
  );
}
