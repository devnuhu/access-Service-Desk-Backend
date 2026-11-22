import { describe, expect, it } from "vitest";
import { createReportSchedule } from "./api/endpoints.js";
import {
  describeSchedule,
  formValues,
  hourLabel,
  ordinal,
  toBody,
} from "./schedule.js";

describe("schedule text", () => {
  it("describes each frequency in Lagos hours", () => {
    expect(describeSchedule({ frequency: "daily", sendHour: 8 })).toBe(
      "Every working day at 08:00",
    );
    expect(
      describeSchedule({ frequency: "weekly", weekDay: "Monday", sendHour: 9 }),
    ).toBe("Every Monday at 09:00");
    expect(
      describeSchedule({ frequency: "monthly", dayOfMonth: 5, sendHour: 8 }),
    ).toBe("Monthly on the 5th at 08:00");
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(23)).toBe("23:00");
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "28th",
    ]);
  });
});

describe("schedule body", () => {
  it("sends weekDay only for weekly and dayOfMonth only for monthly", () => {
    const base = formValues(null, "r-1");
    expect(toBody(base)).toEqual({
      savedReportId: "r-1",
      frequency: "daily",
      sendHour: 8,
      format: "xlsx",
      enabled: true,
      cc: [],
    });
    expect(toBody({ ...base, frequency: "weekly", weekDay: "Friday" })).toEqual(
      expect.objectContaining({ weekDay: "Friday" }),
    );
    expect(
      toBody({ ...base, frequency: "weekly", weekDay: "Friday" }),
    ).not.toHaveProperty("dayOfMonth");
    expect(toBody({ ...base, frequency: "monthly", dayOfMonth: "12" })).toEqual(
      expect.objectContaining({ dayOfMonth: 12 }),
    );
  });

  it("refuses what the server refuses", () => {
    const ok = toBody(formValues(null, "r-1"));
    const parse = (body) => createReportSchedule.body.safeParse(body).success;
    expect(parse(ok)).toBe(true);
    expect(parse({ ...ok, sendHour: 24 })).toBe(false);
    expect(parse({ ...ok, format: "pdf" })).toBe(false);
    expect(parse({ ...ok, frequency: "weekly" })).toBe(false);
    expect(parse({ ...ok, frequency: "monthly" })).toBe(false);
    expect(parse({ ...ok, frequency: "monthly", dayOfMonth: 29 })).toBe(false);
    expect(parse({ ...ok, frequency: "monthly", dayOfMonth: 28 })).toBe(true);
  });
});
