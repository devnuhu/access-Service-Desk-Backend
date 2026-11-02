import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiContractError } from "./apiError.js";
import { buildPath, callEndpoint, defineEndpoint } from "./endpoint.js";

const fakeHttp = (data) => ({ request: vi.fn(async () => ({ data })) });

const getItem = defineEndpoint({
  method: "GET",
  path: "/api/items/{id}",
  query: ["page"],
  response: z.object({ id: z.string(), isActive: z.boolean() }),
});

describe("defineEndpoint", () => {
  it("rejects unknown methods and paths outside /api/", () => {
    expect(() => defineEndpoint({ method: "FETCH", path: "/api/x" })).toThrow();
    expect(() => defineEndpoint({ method: "GET", path: "/x" })).toThrow();
  });
});

describe("buildPath", () => {
  it("fills and encodes placeholders", () => {
    expect(
      buildPath("/api/items/{id}/notes/{noteId}", { id: "a b", noteId: 3 }),
    ).toBe("/api/items/a%20b/notes/3");
  });

  it("fails on a missing placeholder value", () => {
    expect(() => buildPath("/api/items/{id}", {})).toThrow(/id/);
  });
});

describe("callEndpoint", () => {
  it("validates the response and drops unknown fields", async () => {
    const http = fakeHttp({ id: "1", isActive: true, extra: true });
    await expect(
      callEndpoint(http, getItem, { params: { id: "1" } }),
    ).resolves.toEqual({ id: "1", isActive: true });
  });

  it("throws ApiContractError when the response does not match", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const http = fakeHttp({ id: 1 });
    await expect(
      callEndpoint(http, getItem, { params: { id: "1" } }),
    ).rejects.toBeInstanceOf(ApiContractError);
  });

  it("refuses undeclared query parameters and drops empty ones", async () => {
    const http = fakeHttp({ id: "1", isActive: false });
    await expect(
      callEndpoint(http, getItem, {
        params: { id: "1" },
        query: { location: "Lagos" },
      }),
    ).rejects.toThrow(/location/);
    await callEndpoint(http, getItem, {
      params: { id: "1" },
      query: { page: "" },
    });
    expect(http.request.mock.calls[0][0].params).toEqual({});
  });

  it("validates the request body before sending", async () => {
    const create = defineEndpoint({
      method: "POST",
      path: "/api/items",
      body: z.object({ title: z.string().min(1) }),
    });
    const http = fakeHttp({});
    await callEndpoint(http, create, { body: { title: "Analyst" } });
    expect(http.request.mock.calls[0][0].data).toEqual({ title: "Analyst" });
    await expect(
      callEndpoint(http, create, { body: { title: "" } }),
    ).rejects.toThrow();
  });

  it("passes skipAuthRedirect through", async () => {
    const login = defineEndpoint({
      method: "POST",
      path: "/api/auth/login",
      skipAuthRedirect: true,
    });
    const http = fakeHttp({});
    await callEndpoint(http, login);
    expect(http.request.mock.calls[0][0].skipAuthRedirect).toBe(true);
  });
});
