import { describe, expect, it } from "vitest";
import { cellValue, formatCell, formatRunAt } from "./cells.js";

describe("report cells", () => {
  it("formats each column type", () => {
    expect(formatCell(1200, "number")).toBe("1,200");
    expect(formatCell(83.5, "percent")).toBe("83.5%");
    expect(formatCell(4, "hours")).toBe("4.0 h");
    expect(formatCell(2.25, "hours")).toBe("2.3 h");
    expect(formatCell("2026-11-19", "date")).toBe("19 Nov 2026");
    expect(formatCell("2026-11-19T13:05:00Z", "datetime")).toBe(
      "Thu 19 Nov 2026, 14:05 WAT",
    );
    expect(formatCell(true, "boolean")).toBe("Yes");
    expect(formatCell(false, "boolean")).toBe("No");
    expect(formatCell(null, "number")).toBe("");
    expect(formatCell("IT Support", "text")).toBe("IT Support");
  });

  it("reads a row's values in column order", () => {
    const column = { key: "count", label: "Count", type: "number" };
    expect(cellValue(["IT", 12], column, 1)).toBe(12);
    expect(cellValue(null, column, 1)).toBeUndefined();
  });

  it("shows when it ran in Lagos time", () => {
    expect(formatRunAt("2026-11-19T13:05:00Z")).toBe("Run at 14:05");
  });
});
