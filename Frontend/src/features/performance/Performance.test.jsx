import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import MyPerformancePanel from "./components/MyPerformancePanel.jsx";
import UnitPerformance from "./components/UnitPerformance.jsx";
import { bucketLabel, formatHours, formatPercent } from "./format.js";

const figures = (overrides = {}) => ({
  assigned: 0,
  resolved: 0,
  openNow: 0,
  onHold: 0,
  resolvedLate: 0,
  withinSlaPercent: null,
  avgResolutionHours: null,
  avgFirstResponseHours: null,
  respondedInTimePercent: null,
  noResponseInTime: 0,
  reopenedPercent: null,
  ...overrides,
});

const TARGETS = [
  { priority: 1, priorityName: "Low", responseHours: 8, resolutionHours: 40 },
  {
    priority: 2,
    priorityName: "Medium",
    responseHours: 4,
    resolutionHours: 24,
  },
  { priority: 3, priorityName: "High", responseHours: 2, resolutionHours: 16 },
  {
    priority: 4,
    priorityName: "Critical",
    responseHours: 1,
    resolutionHours: 4,
  },
];

/** Four days; nothing resolved on the 2nd and 3rd (a gap in the within-time line). */
const SERIES = [
  {
    date: "2026-11-01",
    assigned: 3,
    resolved: 2,
    raised: 4,
    withinSlaPercent: 100,
  },
  {
    date: "2026-11-02",
    assigned: 0,
    resolved: 0,
    raised: 1,
    withinSlaPercent: null,
  },
  {
    date: "2026-11-03",
    assigned: 1,
    resolved: 0,
    raised: 0,
    withinSlaPercent: null,
  },
  {
    date: "2026-11-04",
    assigned: 2,
    resolved: 4,
    raised: 2,
    withinSlaPercent: 75,
  },
];

const me = (overrides = {}) => ({
  period: { from: "2026-11-01", to: "2026-11-04", bucket: "day" },
  userId: "u-1",
  name: "Amaka Obi",
  figures: figures({
    assigned: 6,
    resolved: 6,
    openNow: 3,
    onHold: 1,
    withinSlaPercent: 83.3,
    avgResolutionHours: 10.5,
    avgFirstResponseHours: null,
    respondedInTimePercent: null,
  }),
  team: figures({ avgResolutionHours: 14, avgFirstResponseHours: 3 }),
  series: SERIES,
  openByStatus: [
    { label: "Assigned", count: 1 },
    { label: "In Progress", count: 1 },
    { label: "Pending", count: 1 },
  ],
  targets: TARGETS,
  ...overrides,
});

const unit = (overrides = {}) => ({
  period: { from: "2026-11-01", to: "2026-11-04", bucket: "day" },
  unitId: "u-cm",
  unitName: "Contribution Matching",
  figures: figures({
    assigned: 9,
    resolved: 8,
    openNow: 5,
    onHold: 2,
    withinSlaPercent: 87.5,
    respondedInTimePercent: 90,
    avgResolutionHours: 12.25,
    avgFirstResponseHours: 2,
    reopenedPercent: null,
  }),
  members: [
    {
      userId: "p-2",
      name: "Chidi One",
      isHead: false,
      figures: figures({
        resolved: 5,
        openNow: 3,
        onHold: 1,
        withinSlaPercent: 80,
      }),
    },
    {
      userId: null,
      name: "Former Staff",
      isHead: false,
      figures: figures({ resolved: 2, withinSlaPercent: 100 }),
    },
    {
      userId: "p-1",
      name: "Hope Head",
      isHead: true,
      figures: figures({ resolved: 1, openNow: 2, onHold: 1 }),
    },
    { userId: "p-3", name: "Idle Ike", isHead: false, figures: figures() },
  ],
  series: SERIES,
  openByStatus: [
    { label: "New", count: 1 },
    { label: "In Progress", count: 3 },
    { label: "Pending", count: 1 },
  ],
  openByPriority: [
    { label: "High", count: 2 },
    { label: "Medium", count: 3 },
  ],
  openByAge: [
    { label: "Under 1 day", count: 2 },
    { label: "Over 7 days", count: 3 },
  ],
  categories: [
    {
      name: "Balance does not agree",
      tickets: 6,
      avgResolutionHours: 9,
      withinSlaPercent: 90,
    },
  ],
  targets: TARGETS,
  ...overrides,
});

function renderPanel(ui, routes) {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    ...Object.fromEntries(
      Object.entries(routes).map(([key, handler]) => [
        key,
        (config) => {
          asked.push({ key, params: config.params, path: config.pathParams });
          return handler(config);
        },
      ]),
    ),
  });
  const view = renderWithProviders(ui, { queryClient });
  return { ...view, asked };
}

afterEach(() => window.sessionStorage.clear());

describe("Formatting", () => {
  it("formats buckets, hours and percentages; null is No data", () => {
    expect(bucketLabel("2026-11-22", "day")).toBe("22 Nov");
    expect(bucketLabel("2026-11-17", "week")).toBe("Week of 17 Nov");
    expect(bucketLabel("2026-11", "month")).toBe("Nov 2026");
    expect(formatHours(10.5)).toBe("10.5 h");
    expect(formatHours(4)).toBe("4 h");
    expect(formatPercent(87.5)).toBe("88%");
    expect(formatHours(null)).toBe("No data");
    expect(formatPercent(null)).toBe("No data");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("My performance", () => {
  it("shows my figures, No data for nulls (never 0), verdicts only when both figures exist, and the targets", async () => {
    renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [200, me()],
    });
    expect(await screen.findByTestId("perf-assigned")).toHaveTextContent("6");
    expect(screen.getByTestId("perf-resolved")).toHaveTextContent("6");
    expect(screen.getByTestId("perf-openNow")).toHaveTextContent("3");
    expect(screen.getByTestId("perf-onHold")).toHaveTextContent("1");

    // First response: mine is null, so No data and no verdict.
    expect(screen.getByTestId("first-response-mine")).toHaveTextContent(
      "No data",
    );
    expect(screen.getByTestId("first-response-percent")).toHaveTextContent(
      "No data",
    );
    expect(
      screen.queryByTestId("first-response-verdict"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("first-response")).toHaveTextContent(
      "target 4 h (Medium)",
    );

    // Resolution: 10.5 h against the team's 14 h.
    expect(screen.getByTestId("resolution-mine")).toHaveTextContent("10.5 h");
    expect(screen.getByTestId("resolution-team")).toHaveTextContent("14 h");
    expect(screen.getByTestId("resolution-verdict")).toHaveTextContent(
      "Better than the team",
    );
    expect(screen.getByTestId("resolution-percent")).toHaveTextContent("83%");

    expect(screen.getByTestId("targets-line")).toHaveTextContent(
      "Critical: respond in 1 h, resolve in 4 h",
    );
    expect(screen.getByTestId("part-Pending")).toHaveTextContent("Pending1");
  });

  it("draws the series: bars for each count, and within-time points only where measured, dashed across the gap", async () => {
    renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [200, me()],
    });
    const bars = await screen.findByTestId("chart-assigned-resolved");
    // Assigned 3, 0, 1, 2 and resolved 2, 0, 0, 4: a bar for each value above 0.
    expect(within(bars).getAllByTestId("chart-bar")).toHaveLength(5);
    expect(within(bars).getByRole("img")).toBeInTheDocument();

    const line = screen.getByTestId("chart-within");
    expect(within(line).getAllByTestId("chart-point")).toHaveLength(2);
    expect(within(line).getByTestId("chart-gap")).toBeInTheDocument();
    // Each bucket can be focused for its exact figures.
    expect(
      within(line).getByLabelText("2 Nov: Within time No data"),
    ).toBeInTheDocument();
    expect(
      within(line).getByLabelText("4 Nov: Within time 75%"),
    ).toBeInTheDocument();
  });

  it("legend toggles a series; an empty period says so", async () => {
    const user = userEvent.setup();
    renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [
        200,
        me({
          series: SERIES.map((p) => ({
            ...p,
            assigned: 0,
            resolved: 0,
            withinSlaPercent: null,
          })),
        }),
      ],
    });
    const bars = await screen.findByTestId("chart-assigned-resolved");
    expect(bars).toHaveTextContent("Nothing in this period");
    expect(screen.getByTestId("chart-within")).toHaveTextContent(
      "Nothing in this period",
    );
    const hide = within(bars).getByRole("button", { name: "Assigned" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    await user.click(hide);
    expect(hide).toHaveAttribute("aria-pressed", "false");
    // The last one shown cannot be hidden.
    expect(
      within(bars).getByRole("button", { name: "Resolved" }),
    ).toBeDisabled();
  });

  it("the period picker changes the query (preset, then custom dates) and is kept while navigating", async () => {
    const user = userEvent.setup();
    const { asked, unmount } = renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [200, me()],
    });
    await screen.findByTestId("perf-assigned");
    expect(asked[0].params).toEqual({ preset: "thismonth" });

    await user.selectOptions(screen.getByLabelText("Period"), "lastmonth");
    await waitFor(() =>
      expect(asked.at(-1).params).toEqual({ preset: "lastmonth" }),
    );

    await user.selectOptions(screen.getByLabelText("Period"), "custom");
    await user.type(screen.getByLabelText("From"), "2026-11-10");
    await user.type(screen.getByLabelText("To"), "2026-11-05");
    expect(
      screen.getByText("The start date must be on or before the end date."),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-11-20");
    await waitFor(() =>
      expect(asked.at(-1).params).toEqual({
        from: "2026-11-10",
        to: "2026-11-20",
      }),
    );

    unmount();
    const again = renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [200, me()],
    });
    await screen.findByTestId("perf-assigned");
    expect(again.asked[0].params).toEqual({
      from: "2026-11-10",
      to: "2026-11-20",
    });
    expect(screen.getByLabelText("Period")).toHaveValue("custom");
  });

  it("shows a 400's message for a bad range", async () => {
    renderPanel(<MyPerformancePanel />, {
      "GET /api/performance/me": () => [
        400,
        { message: "The range is too long." },
      ],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The range is too long.",
    );
  });
});

describe("Unit performance", () => {
  const queueLink = (filter) =>
    `/departments/d-cp/tickets?tab=department&unit=u-cm${filter}`;

  it("shows the tiles with No data for nulls, and the members sorted by resolved (idle ones included)", async () => {
    renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      { "GET /api/performance/units/:unitId": () => [200, unit()] },
    );
    expect(await screen.findByTestId("unit-within")).toHaveTextContent("88%");
    expect(screen.getByTestId("unit-avgResolution")).toHaveTextContent(
      "12.3 h",
    );
    expect(screen.getByTestId("unit-reopened")).toHaveTextContent("No data");

    const compared = screen.getByTestId("chart-members");
    const names = [
      ...compared.querySelectorAll("[data-testid^='bar-row-']"),
    ].map((li) => li.getAttribute("data-testid"));
    expect(names).toEqual([
      "bar-row-p-2",
      "bar-row-gone-1",
      "bar-row-p-1",
      "bar-row-p-3",
    ]);
    // Within time per member: Idle Ike has nothing resolved, so No data.
    const within90 = screen.getByTestId("chart-members-within");
    expect(within(within90).getByTestId("bar-row-p-3")).toHaveTextContent(
      "No data",
    );
    expect(within90).toHaveTextContent("Guide 90%");
  });

  it("a member opens their performance in a side panel; one with a null userId has no drill-down", async () => {
    const user = userEvent.setup();
    const { asked } = renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      {
        "GET /api/performance/units/:unitId": () => [200, unit()],
        "GET /api/performance/people/:userId": () => [
          200,
          me({ name: "Chidi One" }),
        ],
      },
    );
    const compared = await screen.findByTestId("chart-members");
    expect(
      within(compared).queryByRole("button", { name: "Former Staff" }),
    ).not.toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(
      within(table).queryByRole("button", { name: "Former Staff" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(compared).getByRole("button", { name: "Chidi One" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Chidi One" });
    expect(await within(panel).findByTestId("perf-assigned")).toHaveTextContent(
      "6",
    );
    expect(asked.find((a) => a.key.includes("people")).path).toEqual({
      userId: "p-2",
    });
  });

  it("a status opens the unit's list with it; priority and age only highlight", async () => {
    const user = userEvent.setup();
    const { router } = renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      { "GET /api/performance/units/:unitId": () => [200, unit()] },
    );
    const byPriority = await screen.findByTestId("chart-by-priority");
    await user.click(within(byPriority).getByRole("button", { name: "High" }));
    expect(within(byPriority).getByTestId("bar-row-priority-High")).toHaveClass(
      "bg-brand-navy-light",
    );
    expect(
      screen
        .getAllByRole("status")
        .some((el) => /cannot filter by priority yet/.test(el.textContent)),
    ).toBe(true);

    await user.click(
      within(screen.getByTestId("chart-by-status")).getByRole("button", {
        name: "In Progress",
      }),
    );
    expect(router.state.location.pathname).toBe("/departments/d-cp/tickets");
    expect(router.state.location.search).toBe(
      "?tab=department&unit=u-cm&status=3",
    );
  });

  it("the members table sorts by any column; No data sorts last", async () => {
    const user = userEvent.setup();
    renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      { "GET /api/performance/units/:unitId": () => [200, unit()] },
    );
    const table = await screen.findByRole("table");
    const order = () =>
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent.replace("Head", ""));
    expect(order()).toEqual([
      "Chidi One",
      "Former Staff",
      "Hope Head",
      "Idle Ike",
    ]);
    await user.click(
      within(table).getByRole("button", { name: "Within time" }),
    );
    expect(order()).toEqual([
      "Former Staff",
      "Chidi One",
      "Hope Head",
      "Idle Ike",
    ]);
    await user.click(
      within(table).getByRole("button", { name: /Within time/ }),
    );
    expect(order()).toEqual([
      "Chidi One",
      "Former Staff",
      "Hope Head",
      "Idle Ike",
    ]);
    expect(
      within(table).getByRole("columnheader", { name: /Within time/ }),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("Save as report and Schedule open the Reports page with R10 and R3", async () => {
    renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      { "GET /api/performance/units/:unitId": () => [200, unit()] },
    );
    const compared = await screen.findByTestId("chart-members");
    expect(
      within(compared).getByRole("link", { name: "Save as report" }),
    ).toHaveAttribute("href", "/reports?unit=u-cm&report=R10&action=save");
    expect(
      within(screen.getByTestId("chart-members-within")).getByRole("link", {
        name: "Schedule",
      }),
    ).toHaveAttribute("href", "/reports?unit=u-cm&report=R3&action=schedule");
  });

  it("a 403 shows a plain message", async () => {
    renderPanel(
      <UnitPerformance
        unitId="u-cm"
        unitName="Contribution Matching"
        queueLink={queueLink}
      />,
      {
        "GET /api/performance/units/:unitId": () => [
          403,
          { message: "Forbidden." },
        ],
      },
    );
    expect(
      await screen.findByRole("heading", {
        name: "You are not allowed to see this",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/is for the head of the unit/)).toBeInTheDocument();
  });
});
