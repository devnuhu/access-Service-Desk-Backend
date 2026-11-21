import { describe, expect, it } from "vitest";
import { isStructureRole, roleLabel, ROLES, sortRoles } from "./roles.js";

describe("roles", () => {
  it("Department Admin is a structure role with its own label, between HOD and Super Admin", () => {
    expect(roleLabel(ROLES.DepartmentAdmin)).toBe("Department Admin");
    expect(isStructureRole(ROLES.DepartmentAdmin)).toBe(true);
    expect(
      sortRoles(["SuperAdmin", "DepartmentAdmin", "HOD", "Requester"]),
    ).toEqual(["Requester", "HOD", "DepartmentAdmin", "SuperAdmin"]);
  });
});
