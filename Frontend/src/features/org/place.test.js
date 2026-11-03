import { describe, expect, it } from "vitest";
import { describePlaces, isHodOf, leadsUnit } from "./place.js";

const org = {
  departments: [
    {
      id: "d-cp",
      code: "CP",
      name: "Contribution Processing",
      isHod: false,
      units: [
        {
          id: "u-cm",
          code: "CM",
          name: "Contribution Matching",
          isHead: true,
          isDeputy: false,
          isMember: true,
        },
      ],
    },
  ],
};

describe("places from org/me", () => {
  it("describes where a person works", () => {
    expect(describePlaces(org)).toEqual([
      "Contribution Matching · Contribution Processing (Head of Unit)",
    ]);
    expect(describePlaces({ departments: [] })).toEqual([]);
    expect(describePlaces(undefined)).toEqual([]);
  });

  it("knows what a person leads", () => {
    expect(leadsUnit(org, "u-cm")).toBe(true);
    expect(leadsUnit(org, "u-rf")).toBe(false);
    expect(isHodOf(org, "d-cp")).toBe(false);
  });
});
