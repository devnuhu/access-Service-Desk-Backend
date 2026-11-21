import { describe, expect, it } from "vitest";
import {
  formatDueWat,
  formatWat,
  relativeText,
  formatWatClock,
} from "./time.js";

// Tue 17 Nov 2026, 23:30 WAT: late enough that UTC and WAT dates differ.
const LATE = Date.parse("2026-11-17T22:30:00Z");
const MORNING = Date.parse("2026-11-17T09:00:00Z");

describe("formatDueWat", () => {
  it("says Today and Tomorrow by the WAT calendar day", () => {
    expect(formatDueWat("2026-11-17T13:00:00Z", MORNING)).toBe("Today 14:00");
    expect(formatDueWat("2026-11-18T08:30:00Z", MORNING)).toBe(
      "Tomorrow 09:30",
    );
    // 23:15 UTC is 00:15 WAT on the 18th: tomorrow in Lagos
    expect(formatDueWat("2026-11-17T23:15:00Z", MORNING)).toBe(
      "Tomorrow 00:15",
    );
    expect(formatDueWat("2026-11-17T23:15:00Z", LATE)).toBe("Tomorrow 00:15");
  });

  it("otherwise the weekday and date, with the year only when it differs", () => {
    expect(formatDueWat("2026-11-19T13:00:00Z", MORNING)).toBe(
      "Thu 19 Nov, 14:00",
    );
    expect(formatDueWat("2026-11-16T13:00:00Z", MORNING)).toBe(
      "Mon 16 Nov, 14:00",
    );
    expect(formatDueWat("2027-01-04T08:00:00Z", MORNING)).toBe(
      "Mon 4 Jan 2027, 09:00",
    );
  });

  it("empty for nothing or an invalid value", () => {
    expect(formatDueWat(null, MORNING)).toBe("");
    expect(formatDueWat("nope", MORNING)).toBe("");
  });
});

describe("relativeText", () => {
  it("future and past", () => {
    expect(relativeText("2026-11-17T14:00:00Z", MORNING)).toBe("in 5 hours");
    expect(relativeText("2026-11-17T09:30:00Z", MORNING)).toBe("in 30 minutes");
    expect(relativeText("2026-11-19T09:00:00Z", MORNING)).toBe("in 2 days");
    expect(relativeText("2026-11-17T07:00:00Z", MORNING)).toBe("2 hours ago");
    expect(relativeText("2026-11-17T08:59:00Z", MORNING)).toBe("1 minute ago");
  });
});

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

describe("formatWatClock", () => {
  it("shows the WAT hour and minute", () => {
    expect(formatWatClock("2026-11-19T13:05:00Z")).toBe("14:05");
    expect(formatWatClock("2026-11-19T23:30:00Z")).toBe("00:30");
    expect(formatWatClock(null)).toBe("");
  });
});
