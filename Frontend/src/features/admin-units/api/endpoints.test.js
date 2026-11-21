import { describe, expect, it } from "vitest";
import { listAdminDepartments } from "./endpoints.js";

// Swagger marks these nullable since Step 3 (allOf + nullable); check:api compares the declaration
// with swagger, and this checks that a real-shaped answer with nulls parses.
describe("admin departments schema", () => {
  it("accepts null for hod, admin and head", () => {
    const parsed = listAdminDepartments.response.parse([
      {
        id: "d-1",
        code: "CP",
        name: "Contribution Processing",
        isActive: true,
        hod: null,
        admin: null,
        units: [
          {
            id: "u-1",
            departmentId: "d-1",
            code: "CM",
            name: "Contribution Matching",
            isActive: true,
            head: null,
            memberCount: 0,
          },
        ],
      },
    ]);
    expect(parsed[0].hod).toBeNull();
    expect(parsed[0].admin).toBeNull();
    expect(parsed[0].units[0].head).toBeNull();
  });
});
