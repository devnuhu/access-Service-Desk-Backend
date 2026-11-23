import { describe, expect, it } from "vitest";
import {
  highlightParts,
  MAX_RESULTS,
  searchCatalogue,
} from "./requestSearch.js";

const DEPARTMENTS = [
  {
    departmentId: "d-ben",
    name: "Benefits",
    categories: [
      {
        id: "c-ref",
        name: "Refund request",
        description: "Money paid back to a member.",
      },
      {
        id: "c-st",
        name: "Statement copy",
        description: "A copy of a member statement.",
      },
    ],
  },
  {
    departmentId: "d-it",
    name: "Information Technology",
    categories: [
      {
        id: "c-acc",
        name: "System access",
        description: "Log in to an internal system.",
      },
      { id: "c-lap", name: "Laptop fault", description: null },
    ],
  },
];

const ids = (text) =>
  searchCatalogue(DEPARTMENTS, text).map((r) => r.category.id);

describe("searchCatalogue", () => {
  it("matches the name, the description and the department, case-insensitive", () => {
    expect(ids("REFUND")).toEqual(["c-ref"]);
    expect(ids("paid back")).toEqual(["c-ref"]);
    // Only the department matches: equal rank, by name.
    expect(ids("technology")).toEqual(["c-lap", "c-acc"]);
  });

  it("needs every word, in any order; names come before descriptions", () => {
    expect(ids("member copy")).toEqual(["c-st"]);
    expect(ids("statement refund")).toEqual([]);
    // "statement" is in Statement copy's name and only in its description elsewhere.
    expect(ids("statement")).toEqual(["c-st"]);
    expect(ids("member")).toEqual(["c-ref", "c-st"]);
  });

  it("shows nothing for blank text and at most 8 results", () => {
    expect(ids("   ")).toEqual([]);
    const many = [
      {
        departmentId: "d",
        name: "Ops",
        categories: Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          name: `Form ${i}`,
          description: null,
        })),
      },
    ];
    expect(searchCatalogue(many, "form")).toHaveLength(MAX_RESULTS);
  });

  it("highlights every matched word", () => {
    expect(highlightParts("Refund request", ["re"])).toEqual([
      { text: "Re", hit: true },
      { text: "fund ", hit: false },
      { text: "re", hit: true },
      { text: "quest", hit: false },
    ]);
  });
});
