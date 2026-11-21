import { describe, expect, it } from "vitest";
import { getMyAvailability, getUnitAvailability } from "./endpoints.js";

// Swagger marks current nullable since Step 3 (allOf + nullable).
describe("availability schemas", () => {
  it("accept null for current (mine and a unit member's)", () => {
    expect(
      getMyAvailability.response.parse({
        today: "2026-11-03",
        inStructure: true,
        availableNow: true,
        current: null,
        absences: [],
      }).current,
    ).toBeNull();
    const unit = getUnitAvailability.response.parse({
      unitId: "u-1",
      departmentId: "d-1",
      code: "CM",
      name: "Contribution Matching",
      today: "2026-11-03",
      memberCount: 1,
      availableCount: 1,
      members: [
        {
          userId: "p-1",
          userName: "test.caseworker1",
          fullName: null,
          staffCategory: 1,
          isHead: false,
          accountActive: true,
          availableNow: true,
          current: null,
          upcoming: [],
        },
      ],
    });
    expect(unit.members[0].current).toBeNull();
  });
});
