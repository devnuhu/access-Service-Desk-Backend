import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiContractError, ApiError } from "./apiError.js";
import {
  buildPath,
  callEndpoint,
  defineEndpoint,
  fileNameFrom,
} from "./endpoint.js";

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

  it("sends a multipart body as FormData: repeated keys, files, text values", async () => {
    const raise = defineEndpoint({
      method: "POST",
      path: "/api/tickets",
      bodyType: "multipart",
      body: z.object({
        subject: z.string(),
        priority: z.number().optional(),
        isInternal: z.boolean(),
        ccUserIds: z.array(z.string()),
        files: z.array(z.instanceof(Blob)),
        requesterUserId: z.string().optional(),
      }),
    });
    const http = fakeHttp({});
    const pdf = new File(["%PDF"], "Statement.pdf", {
      type: "application/pdf",
    });
    await callEndpoint(http, raise, {
      body: {
        subject: "Refund",
        priority: 3,
        isInternal: false,
        ccUserIds: ["a", "b"],
        files: [pdf],
      },
    });
    const config = http.request.mock.calls[0][0];
    const form = config.data;
    expect(form).toBeInstanceOf(FormData);
    expect(config.headers).toBeUndefined();
    expect(form.get("subject")).toBe("Refund");
    expect(form.get("priority")).toBe("3");
    expect(form.get("isInternal")).toBe("false");
    expect(form.getAll("ccUserIds")).toEqual(["a", "b"]);
    expect(form.getAll("files")).toHaveLength(1);
    expect(form.get("files").name).toBe("Statement.pdf");
    expect(form.has("requesterUserId")).toBe(false);
  });

  it("downloads a blob with the server's file name", async () => {
    const download = defineEndpoint({
      method: "GET",
      path: "/api/files/{id}",
      responseType: "blob",
    });
    const blob = new Blob(["data"]);
    const http = {
      request: vi.fn(async () => ({
        data: blob,
        headers: {
          "content-disposition":
            "attachment; filename=Statement.pdf; filename*=UTF-8''R%C3%A9sum%C3%A9%20Q3.pdf",
        },
      })),
    };
    await expect(
      callEndpoint(http, download, { params: { id: "1" } }),
    ).resolves.toEqual({ blob, fileName: "Résumé Q3.pdf" });
    expect(http.request.mock.calls[0][0].responseType).toBe("blob");
  });

  it("reads the message of a failed download from its JSON blob", async () => {
    const download = defineEndpoint({
      method: "GET",
      path: "/api/files/{id}",
      responseType: "blob",
    });
    const body = new Blob([JSON.stringify({ message: "File not found." })]);
    const failure = new ApiError({
      kind: "notFound",
      status: 404,
      cause: { response: { status: 404, data: body } },
    });
    const http = { request: vi.fn(async () => Promise.reject(failure)) };
    await expect(
      callEndpoint(http, download, { params: { id: "1" } }),
    ).rejects.toMatchObject({ status: 404, message: "File not found." });
  });
});

describe("fileNameFrom", () => {
  it("prefers filename*, then filename, then the fallback", () => {
    expect(fileNameFrom('attachment; filename="A b.pdf"')).toBe("A b.pdf");
    expect(fileNameFrom("attachment; filename=plain.csv")).toBe("plain.csv");
    expect(fileNameFrom(undefined, "x.pdf")).toBe("x.pdf");
  });
});
