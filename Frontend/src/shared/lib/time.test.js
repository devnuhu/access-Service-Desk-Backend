import { describe, expect, it } from "vitest";
import { formatWat } from "./time.js";

describe("formatWat", () => {
  it("shows a UTC time in WAT (UTC+1)", () => {
    expect(formatWat("2026-11-02T14:42:00Z")).toBe("Mon 2 Nov 2026, 15:42 WAT");
  });

  it("reads a time without a zone as UTC", () => {
    expect(formatWat("2026-11-02T14:42:00")).toBe("Mon 2 Nov 2026, 15:42 WAT");
  });

  it("crosses midnight into the next WAT day", () => {
    expect(formatWat("2026-11-02T23:30:00Z")).toBe("Tue 3 Nov 2026, 00:30 WAT");
  });

  it("returns an empty string for nothing or an invalid value", () => {
    expect(formatWat(null)).toBe("");
    expect(formatWat("not a date")).toBe("");
  });
});
