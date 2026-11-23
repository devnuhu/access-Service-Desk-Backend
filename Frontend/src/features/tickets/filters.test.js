import { describe, expect, it } from "vitest";
import {
  AGE_BANDS,
  ageBandFromLabel,
  ageBandLabel,
  PRIORITY_OPTIONS,
  priorityFromLabel,
  priorityLabel,
  readAgeBand,
  readPriority,
} from "./filters.js";
import { fromFilter, toFilter } from "./views.js";

describe("priority and age maps", () => {
  it("priority: label to number and back", () => {
    expect(
      ["Low", "Medium", "High", "Critical"].map(priorityFromLabel),
    ).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map(priorityLabel)).toEqual([
      "Low",
      "Medium",
      "High",
      "Critical",
    ]);
    expect(priorityFromLabel(" critical ")).toBe(4);
    expect(priorityFromLabel("Urgent")).toBeNull();
    expect(priorityLabel(9)).toBeNull();
    expect(PRIORITY_OPTIONS.map((o) => o.label)).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
    ]);
  });

  it("age band: label to number and back, exactly the five chart bars", () => {
    expect(AGE_BANDS.map((b) => b.label)).toEqual([
      "Under 1 day",
      "1 to 2 days",
      "3 to 5 days",
      "6 to 10 days",
      "Over 10 days",
    ]);
    for (const band of AGE_BANDS) {
      expect(ageBandFromLabel(band.label)).toBe(band.id);
      expect(ageBandLabel(band.id)).toBe(band.label);
    }
    expect(ageBandFromLabel("Over 10 days")).toBe(5);
    expect(ageBandFromLabel("Over 7 days")).toBeNull();
    expect(ageBandLabel(6)).toBeNull();
  });

  it("reads only known values from the address", () => {
    expect(readPriority("3")).toBe("3");
    expect([null, "", "0", "5", "high", "2.5"].map(readPriority)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(readAgeBand("5")).toBe("5");
    expect(["6", "0", "x", null].map(readAgeBand)).toEqual(["", "", "", ""]);
  });

  it("saved views keep priority and age; an age makes the view the open list", () => {
    const filter = toFilter({
      tab: "unit",
      status: "open",
      priority: "4",
      ageBand: "2",
    });
    expect(filter).toEqual({
      tab: "unit",
      open: true,
      priority: 4,
      ageBand: 2,
    });
    const back = fromFilter({
      tab: "unit",
      status: 5,
      ageBand: 2,
      priority: 4,
    });
    expect(back).toMatchObject({ status: "open", ageBand: "2", priority: "4" });
    expect(fromFilter({ tab: "unit", ageBand: 9 }).ageBand).toBe("");
  });
});
