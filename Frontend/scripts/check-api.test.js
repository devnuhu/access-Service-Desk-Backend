// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEndpoint } from "../src/shared/lib/http/endpoint.js";
import {
  checkAccessTable,
  checkEndpoint,
  inventoryAccess,
  normalizePath,
  parseInventory,
  zodObjectShape,
} from "./check-api.js";

// A minimal swagger document in the shape Swashbuckle produces. Test input only.
const json = (ref) => ({
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
  },
});

const swagger = {
  paths: {
    "/api/admin/users/{userId}": {
      get: { responses: { 200: json("AdminUser") } },
    },
    "/api/admin/users": {
      get: {
        parameters: [
          { name: "page", in: "query" },
          { name: "search", in: "query" },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/api/admin/users/{userId}/roles": {
      post: {
        requestBody: { required: true, ...json("AssignRole") },
        responses: { 200: { description: "OK" } },
      },
    },
    "/api/Auth/login": {
      post: {
        requestBody: json("LoginRequest"),
        responses: { 200: json("Session") },
      },
    },
    "/api/Auth/refresh": {
      post: {
        requestBody: json("RefreshTokenRequest"),
        responses: { 200: json("Session") },
      },
    },
  },
  components: {
    schemas: {
      AdminUser: {
        type: "object",
        properties: { id: { type: "string" }, userName: { type: "string" } },
      },
      AssignRole: {
        type: "object",
        required: ["roleId"],
        properties: { roleId: { type: "string" } },
      },
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string" },
          password: { type: "string" },
        },
      },
      RefreshTokenRequest: {
        type: "object",
        properties: { refreshToken: { type: "string" } },
      },
      Session: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          csrfToken: { type: "string" },
        },
      },
    },
  },
};

const check = (definition) =>
  checkEndpoint(defineEndpoint(definition), swagger);

describe("check-api", () => {
  it("normalizes case and placeholder names", () => {
    expect(normalizePath("/api/Admin/Users/{id}/")).toBe("/api/admin/users/{}");
  });

  it("unwraps zod wrappers to the object shape", () => {
    const shape = zodObjectShape(
      z.array(z.object({ a: z.string() })).optional(),
    );
    expect(Object.keys(shape)).toEqual(["a"]);
  });

  it("passes a matching endpoint", () => {
    const result = check({
      method: "GET",
      path: "/api/admin/users/{userId}",
      response: z.object({ id: z.string(), userName: z.string() }),
    });
    expect(result.problems).toEqual([]);
  });

  it("reports unknown routes, methods and query names", () => {
    expect(check({ method: "GET", path: "/api/nothing" }).problems[0]).toMatch(
      /route not found/,
    );
    expect(
      check({ method: "DELETE", path: "/api/admin/users/{userId}" })
        .problems[0],
    ).toMatch(/method not found/);
    expect(
      check({
        method: "GET",
        path: "/api/admin/users",
        query: ["page", "department"],
      }).problems,
    ).toEqual([expect.stringMatching(/"department"/)]);
  });

  it("reports body properties the schema does not have and missing required ones", () => {
    const { problems } = check({
      method: "POST",
      path: "/api/admin/users/{userId}/roles",
      body: z.object({
        roleId: z.string().optional(),
        roleName: z.string(),
      }),
    });
    expect(problems).toEqual([
      expect.stringMatching(/"roleName" is not in the request schema/),
      expect.stringMatching(/"roleId" is required .* but optional/),
    ]);
  });

  it("reports a required body that is not sent", () => {
    expect(
      check({ method: "POST", path: "/api/admin/users/{userId}/roles" })
        .problems[0],
    ).toMatch(/requires one/);
  });

  it("reports response properties the schema does not have, with near misses", () => {
    const { problems } = check({
      method: "GET",
      path: "/api/admin/users/{userId}",
      response: z.object({ UserName: z.string(), roles: z.array(z.string()) }),
    });
    expect(problems).toEqual([
      expect.stringMatching(/"UserName".*did you mean "userName"/),
      expect.stringMatching(/"roles" is not in the response schema/),
    ]);
  });

  it("warns instead of failing when swagger documents no response properties", () => {
    const result = check({
      method: "GET",
      path: "/api/admin/users",
      query: ["page"],
      response: z.object({ total: z.number() }),
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings[0]).toMatch(/no response properties/);
  });

  it("refuses reading the tokens from the login body", () => {
    const { problems } = check({
      method: "POST",
      path: "/api/Auth/login",
      body: z.object({ username: z.string(), password: z.string() }),
      response: z.object({ accessToken: z.string(), csrfToken: z.string() }),
    });
    expect(problems).toEqual([
      expect.stringMatching(/must not read "accessToken"/),
    ]);
  });

  it("refuses sending the refresh token in the body", () => {
    const { problems } = check({
      method: "POST",
      path: "/api/auth/refresh",
      body: z.object({ refreshToken: z.string() }),
    });
    expect(problems).toContainEqual(
      expect.stringMatching(/must not send "refreshToken"/),
    );
  });

  it("reports a response difference as a warning when the deviation is documented", () => {
    const result = check({
      method: "GET",
      path: "/api/admin/users/{userId}",
      response: z.object({ statusCode: z.number(), data: z.string() }),
      swaggerDeviation: "wrapped in ApiResponse",
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/known deviation: wrapped in ApiResponse/),
    );
  });
});

describe("access table", () => {
  it("parses inventory rows and maps policies, roles and plain access", () => {
    const rows = parseInventory(
      [
        "| Verb | Route | Access | Action | Note |",
        "|---|---|---|---|---|",
        "| GET | `/api/admin/users` | Policy: Super_Admin_Only | List |  |",
        "| GET | `/api/directory/users/search` | Policy: Unit_Management | Search |  |",
        "| POST | `/api/Auth/login` | Anonymous | Login |  |",
      ].join("\n"),
    );
    expect(rows).toHaveLength(3);
    expect(inventoryAccess(rows[0].access)).toEqual(["SuperAdmin"]);
    expect(inventoryAccess(rows[1].access)).toEqual([
      "HeadOfUnit",
      "SuperAdmin",
    ]);
    expect(inventoryAccess(rows[2].access)).toBe("anonymous");
    expect(inventoryAccess("Signed in")).toBe("signedIn");
    expect(inventoryAccess("Policy: Nope")).toMatch(/unknown policy/);
  });

  it("flags declared endpoints without a role and inventory differences", () => {
    const declared = [
      { method: "GET", path: "/api/not-in-table", location: "x.js:1" },
    ];
    const inventory = [
      {
        method: "GET",
        path: "/api/admin/roles",
        access: "Policy: Unit_Management",
      },
    ];
    const { problems } = checkAccessTable({ paths: {} }, declared, inventory);
    expect(problems).toContainEqual(
      expect.stringMatching(/not-in-table has no expected role/),
    );
    expect(problems).toContainEqual(
      expect.stringContaining(
        "GET /api/admin/roles expected SuperAdmin, inventory says HeadOfUnit, SuperAdmin",
      ),
    );
  });
});
