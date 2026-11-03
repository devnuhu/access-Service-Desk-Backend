import axios from "axios";
import { isCsrfFailure, toApiError } from "./apiError.js";
import { getCsrfToken, setCsrfToken } from "./csrf.js";

const CSRF_HEADER = "X-CSRF-Token";
const STATE_CHANGING = new Set(["post", "put", "patch", "delete"]);

/**
 * Creates the one HTTP client the API layer uses.
 * Shared code does not import features: the app passes in how to refresh the session, how to get
 * a new CSRF token and what to do when the session cannot be saved.
 *
 * Tokens live in HttpOnly cookies set by the API (withCredentials). The web app never reads them
 * and never sends an Authorization header.
 *
 * CSRF: every POST, PUT, PATCH and DELETE carries X-CSRF-Token (memory only). A token in any
 * X-CSRF-Token response header replaces it. A 403 "Security check failed" fetches a new token and
 * retries the request once.
 *
 * 401 on a signed-in call: refresh once (one refresh shared by every request that failed at the
 * same time), then retry the original request once. The API ends every session if a used refresh
 * token comes back, so a request sent before a refresh finished and failing afterwards is retried
 * without starting another refresh. If refresh fails, onUnauthorized ends the session.
 * Requests marked skipAuthRedirect (login, refresh, logout) never trigger this.
 * instance.refreshSession() starts (or joins) that same shared refresh; it resolves true or false.
 * Any other 403 never ends the session; it rejects with an ApiError of kind "forbidden".
 *
 * @param {Object} options
 * @param {string} options.baseURL  "" for same origin
 * @param {() => Promise<boolean>} [options.refreshSession]  resolves true when the cookies were renewed
 * @param {() => Promise<unknown>} [options.fetchCsrfToken]  gets and stores a new CSRF token
 * @param {() => void} options.onUnauthorized  called when the session cannot be refreshed
 * @param {import("axios").AxiosAdapter} [options.adapter]  tests only
 * @returns {import("axios").AxiosInstance}
 */
export function createHttpClient({
  baseURL,
  refreshSession,
  fetchCsrfToken,
  onUnauthorized,
  adapter,
}) {
  const instance = axios.create({ baseURL, withCredentials: true, adapter });
  let refreshing = null;
  // Counts finished refreshes, so a late 401 can tell that a refresh already happened after it left.
  let refreshGeneration = 0;

  const refreshOnce = () => {
    if (!refreshing) {
      refreshing = Promise.resolve(refreshSession ? refreshSession() : false)
        .catch(() => false)
        .then((ok) => {
          if (ok) refreshGeneration += 1;
          return ok;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  };

  // The same shared refresh for callers outside a failed request (a live "your access changed").
  instance.refreshSession = refreshOnce;

  instance.interceptors.request.use((config) => {
    config.sentGeneration = refreshGeneration;
    config.headers.delete("Authorization");
    const token = getCsrfToken();
    if (STATE_CHANGING.has(String(config.method).toLowerCase()) && token) {
      config.headers.set(CSRF_HEADER, token);
    } else {
      config.headers.delete(CSRF_HEADER);
    }
    return config;
  });

  const captureCsrf = (response) => {
    const header = response?.headers?.[CSRF_HEADER.toLowerCase()];
    if (typeof header === "string" && header) setCsrfToken(header);
  };

  instance.interceptors.response.use(
    (response) => {
      captureCsrf(response);
      return response;
    },
    async (error) => {
      const config = error?.config;
      captureCsrf(error?.response);
      const apiError = toApiError(error);

      if (
        apiError.kind === "unauthorized" &&
        config &&
        !config.skipAuthRedirect
      ) {
        if (!config.retriedAfterRefresh) {
          const alreadyRefreshed = config.sentGeneration !== refreshGeneration;
          if (alreadyRefreshed || (await refreshOnce())) {
            config.retriedAfterRefresh = true;
            return instance.request(config);
          }
        }
        onUnauthorized();
      }

      if (
        isCsrfFailure(apiError) &&
        config &&
        !config.retriedAfterCsrf &&
        fetchCsrfToken
      ) {
        config.retriedAfterCsrf = true;
        try {
          await fetchCsrfToken();
        } catch {
          return Promise.reject(apiError);
        }
        return instance.request(config);
      }

      return Promise.reject(apiError);
    },
  );

  return instance;
}
