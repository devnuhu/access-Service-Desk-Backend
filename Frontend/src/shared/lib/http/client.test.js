import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./client.js";
import { clearCsrfToken, getCsrfToken, setCsrfToken } from "./csrf.js";

function respond(config, status, data = {}, headers = {}) {
  const response = { status, data, headers, config, statusText: "" };
  if (status < 400) return response;
  const error = new Error(`Request failed with status code ${status}`);
  error.config = config;
  error.response = response;
  error.isAxiosError = true;
  throw error;
}

const CSRF_FAILED = {
  statusCode: 403,
  message: "Security check failed. Refresh the page and try again.",
};

afterEach(() => clearCsrfToken());

describe("createHttpClient", () => {
  it("sends cookies and never an Authorization header", async () => {
    const adapter = vi.fn(async (config) => respond(config, 200));
    const http = createHttpClient({
      baseURL: "",
      onUnauthorized: vi.fn(),
      adapter,
    });
    await http.get("/api/Auth/me", {
      headers: { Authorization: "Bearer x" },
    });
    const sent = adapter.mock.calls[0][0];
    expect(sent.withCredentials).toBe(true);
    expect(sent.headers.has("Authorization")).toBe(false);
  });

  it("sends the CSRF header on POST, PATCH and DELETE and not on GET", async () => {
    setCsrfToken("csrf-1");
    const adapter = vi.fn(async (config) => respond(config, 200));
    const http = createHttpClient({
      baseURL: "",
      onUnauthorized: vi.fn(),
      adapter,
    });
    await http.get("/api/notifications");
    await http.post("/api/admin/users/1/roles", { roleId: "r" });
    await http.patch("/api/notifications/read-all");
    await http.delete("/api/admin/users/1/roles/r");
    const header = (i) => adapter.mock.calls[i][0].headers.get("X-CSRF-Token");
    expect(header(0)).toBeFalsy();
    expect(header(1)).toBe("csrf-1");
    expect(header(2)).toBe("csrf-1");
    expect(header(3)).toBe("csrf-1");
  });

  it("keeps the token from an X-CSRF-Token response header", async () => {
    const http = createHttpClient({
      baseURL: "",
      onUnauthorized: vi.fn(),
      adapter: vi.fn(async (config) =>
        respond(config, 200, {}, { "x-csrf-token": "from-header" }),
      ),
    });
    await http.get("/api/Auth/csrf");
    expect(getCsrfToken()).toBe("from-header");
  });

  it("one 401 triggers exactly one refresh even with three requests in parallel", async () => {
    let session = "expired";
    const refreshSession = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      session = "good";
      return true;
    });
    const adapter = vi.fn(async (config) =>
      respond(config, session === "good" ? 200 : 401, { ok: true }),
    );
    const onUnauthorized = vi.fn();
    const http = createHttpClient({
      baseURL: "",
      refreshSession,
      onUnauthorized,
      adapter,
    });
    const results = await Promise.all([
      http.get("/a"),
      http.get("/b"),
      http.get("/c"),
    ]);
    expect(results.map((r) => r.data)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(6);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("never refreshes twice: a late 401 after a finished refresh only retries", async () => {
    let session = "expired";
    const refreshSession = vi.fn(async () => {
      session = "good";
      return true;
    });
    let releaseLate;
    const lateGate = new Promise((resolve) => (releaseLate = resolve));
    const adapter = vi.fn(async (config) => {
      if (config.url === "/late" && !config.retriedAfterRefresh) {
        // Leaves with the old session, answers after the refresh has finished.
        await lateGate;
        return respond(config, 401);
      }
      return respond(config, session === "good" ? 200 : 401, { ok: true });
    });
    const http = createHttpClient({
      baseURL: "",
      refreshSession,
      onUnauthorized: vi.fn(),
      adapter,
    });
    const late = http.get("/late");
    await http.get("/first");
    releaseLate();
    await expect(late).resolves.toMatchObject({ data: { ok: true } });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("refreshSession() joins a refresh already started by a 401", async () => {
    let session = "expired";
    let finishRefresh;
    const refreshSession = vi.fn(async () => {
      await new Promise((resolve) => (finishRefresh = resolve));
      session = "good";
      return true;
    });
    const adapter = vi.fn(async (config) =>
      respond(config, session === "good" ? 200 : 401, { ok: true }),
    );
    const http = createHttpClient({
      baseURL: "",
      refreshSession,
      onUnauthorized: vi.fn(),
      adapter,
    });
    const failed = http.get("/a");
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    const renewing = http.refreshSession();
    finishRefresh();
    const [retried, renewed] = await Promise.all([failed, renewing]);
    expect(retried.data).toEqual({ ok: true });
    expect(renewed).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("ends the session when refresh fails, and does not retry", async () => {
    const onUnauthorized = vi.fn();
    const adapter = vi.fn(async (config) => respond(config, 401));
    const http = createHttpClient({
      baseURL: "",
      refreshSession: async () => false,
      onUnauthorized,
      adapter,
    });
    await expect(http.get("/api/admin/users")).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("never refreshes for login: the server message is returned as is", async () => {
    const refreshSession = vi.fn(async () => true);
    const onUnauthorized = vi.fn();
    const http = createHttpClient({
      baseURL: "",
      refreshSession,
      onUnauthorized,
      adapter: vi.fn(async (config) =>
        respond(config, 401, {
          statusCode: 401,
          message: "Invalid username or password",
        }),
      ),
    });
    await expect(
      http.post("/api/Auth/login", {}, { skipAuthRedirect: true }),
    ).rejects.toMatchObject({ message: "Invalid username or password" });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 403 "Security check failed" refetches the token and retries once', async () => {
    setCsrfToken("stale");
    const fetchCsrfToken = vi.fn(async () => setCsrfToken("fresh"));
    const adapter = vi.fn(async (config) =>
      config.headers.get("X-CSRF-Token") === "fresh"
        ? respond(config, 200, { message: "Role given." })
        : respond(config, 403, CSRF_FAILED),
    );
    const http = createHttpClient({
      baseURL: "",
      fetchCsrfToken,
      onUnauthorized: vi.fn(),
      adapter,
    });
    const response = await http.post("/api/admin/users/1/roles", {
      roleId: "r",
    });
    expect(response.data).toEqual({ message: "Role given." });
    expect(fetchCsrfToken).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('retries a "Security check failed" only once', async () => {
    const fetchCsrfToken = vi.fn(async () => setCsrfToken("still-wrong"));
    const adapter = vi.fn(async (config) => respond(config, 403, CSRF_FAILED));
    const http = createHttpClient({
      baseURL: "",
      fetchCsrfToken,
      onUnauthorized: vi.fn(),
      adapter,
    });
    await expect(
      http.patch("/api/notifications/read-all"),
    ).rejects.toMatchObject({ status: 403, message: CSRF_FAILED.message });
    expect(fetchCsrfToken).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("never signs out or refetches CSRF on a plain 403", async () => {
    const refreshSession = vi.fn();
    const fetchCsrfToken = vi.fn();
    const onUnauthorized = vi.fn();
    const http = createHttpClient({
      baseURL: "",
      refreshSession,
      fetchCsrfToken,
      onUnauthorized,
      adapter: vi.fn(async (config) => respond(config, 403, "")),
    });
    await expect(http.get("/api/admin/users")).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchCsrfToken).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
