/* global process */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  daysInclusive,
  formatDay,
  formatRange,
  formatShortDay,
  formatShortRange,
} from "./dates.js";

// A time zone behind UTC: new Date("2026-11-03") would show Mon 2 Nov here.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("dates", () => {
  it("formats a day without moving it, whatever the time zone", () => {
    expect(new Date("2026-11-03").getDate()).toBe(2); // the trap this module avoids
    expect(formatDay("2026-11-03")).toBe("Tue 3 Nov 2026");
    expect(formatShortDay("2026-11-05")).toBe("5 Nov");
  });

  it("counts days with both ends included", () => {
    expect(daysInclusive("2026-11-09", "2026-11-13")).toBe(5);
    expect(daysInclusive("2026-11-09", "2026-11-09")).toBe(1);
  });

  it("adds days across a month end and a year end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("formats ranges", () => {
    expect(formatRange("2026-11-09", "2026-11-13")).toBe(
      "Mon 9 Nov – Fri 13 Nov 2026",
    );
    expect(formatRange("2026-12-31", "2027-01-01")).toBe(
      "Thu 31 Dec 2026 – Fri 1 Jan 2027",
    );
    expect(formatRange("2026-11-09", "2026-11-09")).toBe("Mon 9 Nov 2026");
    expect(formatShortRange("2026-11-09", "2026-11-13")).toBe("9–13 Nov");
    expect(formatShortRange("2026-11-30", "2026-12-02")).toBe("30 Nov – 2 Dec");
  });
});
