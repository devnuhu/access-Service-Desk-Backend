import { vi } from "vitest";
import { configureHttp, createHttpClient } from "@/shared/lib/http";
import { endSession, fetchCsrfToken, refreshSession } from "@/features/auth";

/**
 * A fake axios adapter answering from a route table; no real network in tests.
 * Keys are "METHOD /path" with ":name" placeholders. A handler gets the axios config (with
 * `body` parsed and `pathParams`) and returns [status, data] or [status, data, headers].
 * Unknown routes answer 404 and are recorded in `unmatched`.
 */
export function fakeApi(routes) {
  const table = Object.entries(routes).map(([key, handler]) => {
    const [method, path] = key.split(" ");
    const names = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_, name) => {
        names.push(name);
        return "([^/]+)";
      })}$`,
      "i",
    );
    return { method, pattern, names, handler };
  });
  const unmatched = [];

  const adapter = vi.fn(async (config) => {
    const method = config.method.toUpperCase();
    const url = config.url.split("?")[0];
    const route = table.find(
      (entry) => entry.method === method && entry.pattern.test(url),
    );
    let status = 404;
    let data = { message: "Not found (fake API)." };
    let headers = {};
    if (route) {
      const match = url.match(route.pattern);
      const pathParams = Object.fromEntries(
        route.names.map((name, i) => [name, decodeURIComponent(match[i + 1])]),
      );
      const body =
        typeof config.data === "string" ? JSON.parse(config.data) : config.data;
      [status, data, headers = {}] = await route.handler({
        ...config,
        body,
        pathParams,
      });
    } else {
      unmatched.push(`${method} ${url}`);
    }
    const response = { status, data, headers, config, statusText: "" };
    if (status < 400) return response;
    const error = new Error(`Request failed with status code ${status}`);
    error.config = config;
    error.response = response;
    error.isAxiosError = true;
    throw error;
  });

  return { adapter, unmatched };
}

/** Points the app's one HTTP client at a fake API, wired like src/app/setupHttp.js. */
export function installFakeApi(queryClient, routes) {
  const api = fakeApi(routes);
  configureHttp(
    createHttpClient({
      baseURL: "",
      adapter: api.adapter,
      refreshSession,
      fetchCsrfToken,
      onUnauthorized: () => endSession(queryClient),
    }),
  );
  return api;
}
