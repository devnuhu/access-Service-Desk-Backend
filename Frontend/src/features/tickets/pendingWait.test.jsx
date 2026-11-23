import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatWatDay, watDaysSince } from "@/shared/lib/time";
import PendingWaitChip from "./components/PendingWaitChip.jsx";
import {
  daysText,
  oldestWaitingFirst,
  PENDING_WAIT_DAYS,
  waitChipText,
  waitingLine,
  waitTone,
} from "./pendingWait.js";

// 09:00 WAT on Tue 17 Nov 2026.
const NOW = new Date("2026-11-17T08:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("waiting days", () => {
  it("counts WAT calendar days: today, 1 day, N days", () => {
    expect(daysText(0)).toBe("today");
    expect(daysText(1)).toBe("1 day");
    expect(daysText(5)).toBe("5 days");
    // 00:30 WAT the same day is today; 23:30 WAT the day before is 1 day.
    expect(watDaysSince("2026-11-16T23:30:00Z", NOW)).toBe(0);
    expect(watDaysSince("2026-11-16T22:30:00Z", NOW)).toBe(1);
    expect(watDaysSince(daysAgo(5), NOW)).toBe(5);
    expect(watDaysSince(null, NOW)).toBeNull();
    expect(formatWatDay("2026-11-12T09:00:00Z", NOW)).toBe("12 Nov");
    expect(formatWatDay("2025-12-30T09:00:00Z", NOW)).toBe("30 Dec 2025");
  });

  it("is neutral up to 4 days, amber from 5, red from 10", () => {
    expect(PENDING_WAIT_DAYS).toEqual({ amber: 5, red: 10 });
    expect([0, 4, 5, 9, 10, 30].map(waitTone)).toEqual([
      "neutral",
      "neutral",
      "amber",
      "amber",
      "red",
      "red",
    ]);
  });

  it('says "you" to the requester, "the requester" or "a third party" otherwise', () => {
    const ticket = (reason, since) => ({
      pendingReason: reason,
      pendingSince: since,
    });
    expect(
      waitingLine(ticket(1, "2026-11-12T09:00:00Z"), {
        isRequester: true,
        now: NOW,
      }).text,
    ).toBe("Waiting on you since 12 Nov (5 days)");
    expect(
      waitingLine(ticket(1, "2026-11-16T09:00:00Z"), { now: NOW }).text,
    ).toBe("Waiting on the requester since 16 Nov (1 day)");
    expect(
      waitingLine(ticket(2, "2026-11-17T07:00:00Z"), {
        isRequester: true,
        now: NOW,
      }).text,
    ).toBe("Waiting on a third party since 17 Nov (today)");
    expect(waitingLine(ticket(1, null), { now: NOW })).toBeNull();
    expect(waitChipText(1, 5)).toBe("Waiting on requester · 5d");
    expect(waitChipText(2, 0)).toBe("Waiting on third party · 0d");
  });
});

describe("oldestWaitingFirst", () => {
  it("sorts by pendingSince, oldest first; none last, order kept on ties", () => {
    const ids = oldestWaitingFirst([
      { id: "a", pendingSince: daysAgo(1) },
      { id: "b", pendingSince: null },
      { id: "c", pendingSince: daysAgo(9) },
      { id: "d", pendingSince: daysAgo(1) },
    ]).map((t) => t.id);
    expect(ids).toEqual(["c", "a", "d", "b"]);
  });
});

describe("PendingWaitChip", () => {
  const chip = (overrides) =>
    render(
      <PendingWaitChip
        now={NOW}
        ticket={{
          status: 4,
          pendingReason: 1,
          pendingSince: daysAgo(4),
          ...overrides,
        }}
      />,
    );

  it.each([
    [4, "neutral", "Waiting on requester · 4d"],
    [5, "amber", "Waiting on requester · 5d"],
    [10, "red", "Waiting on requester · 10d"],
  ])("at %i days is %s", (days, tone, text) => {
    chip({ pendingSince: daysAgo(days) });
    const el = screen.getByTestId("pending-wait");
    expect(el).toHaveAttribute("data-tone", tone);
    expect(el).toHaveTextContent(text);
  });

  it('says "you" on the requester\'s own list', () => {
    render(
      <PendingWaitChip
        now={NOW}
        you
        ticket={{ status: 4, pendingReason: 1, pendingSince: daysAgo(0) }}
      />,
    );
    expect(screen.getByTestId("pending-wait")).toHaveTextContent(
      "Waiting on you · 0d",
    );
  });

  it("names a third party", () => {
    chip({ pendingReason: 2 });
    expect(screen.getByTestId("pending-wait")).toHaveTextContent(
      "Waiting on third party · 4d",
    );
  });

  it.each([1, 2, 3, 5, 6, 7, 8])("shows nothing for status %i", (status) => {
    chip({ status });
    expect(screen.queryByTestId("pending-wait")).not.toBeInTheDocument();
  });

  it("shows nothing without a pendingSince", () => {
    chip({ pendingSince: null });
    expect(screen.queryByTestId("pending-wait")).not.toBeInTheDocument();
  });
});
