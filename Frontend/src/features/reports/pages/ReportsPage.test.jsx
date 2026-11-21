import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import ReportsPage from "./ReportsPage.jsx";

const report = (id, name, extra = {}) => ({
  id,
  name,
  description: null,
  ownerName: "Amaka Obi",
  isMine: true,
  share: "private",
  shareUnitId: null,
  shareDepartmentId: null,
  shareRoles: [],
  definition: { title: null, source: "tickets", mode: "summary" },
  createdAt: "2026-11-18T09:00:00Z",
  updatedAt: null,
  ...extra,
});

const schedule = (id, savedReportId, reportName, extra = {}) => ({
  id,
  savedReportId,
  reportName,
  frequency: "daily",
  weekDay: null,
  dayOfMonth: null,
  sendHour: 8,
  format: "xlsx",
  enabled: true,
  nextRunAt: "2026-11-20T07:00:00Z",
  lastSentAt: null,
  lastStatus: null,
  lastError: null,
  createdAt: "2026-11-18T09:00:00Z",
  updatedAt: null,
  ...extra,
});

const R1_DEFINITION = {
  title: "Tickets by unit",
  source: "tickets",
  mode: "summary",
  preset: "thisMonth",
  from: null,
  to: null,
  groupBy: "unit",
  measures: ["opened", "resolved"],
  // A field this screen does not know still goes back unchanged.
  futureOption: { keep: true },
};

const CATALOGUE = {
  measures: [],
  groupBys: [],
  columns: [],
  leaveColumns: [],
  presets: [
    { key: "today", label: "Today" },
    { key: "last7", label: "Last 7 days" },
    { key: "thisMonth", label: "This month" },
  ],
  dateFields: [],
  charts: [],
  builtIn: [
    {
      code: "R1",
      name: "Tickets by unit",
      description: "Opened and resolved per unit.",
      definition: R1_DEFINITION,
    },
    {
      code: "R2",
      name: "SLA breaches",
      description: "Tickets past their due time.",
      definition: { title: "SLA breaches", mode: "list" },
    },
  ],
};

const RESULT = {
  title: "Tickets by unit",
  source: "tickets",
  mode: "summary",
  chart: "table",
  from: "2026-11-01",
  to: "2026-11-19",
  columns: [
    { key: "group", label: "Unit", type: "text" },
    { key: "opened", label: "Opened", type: "number" },
    { key: "rate", label: "On time", type: "percent" },
  ],
  rows: [["Refund", 1200, 87.5]],
  totals: [null, 1200, 87.5],
  truncated: false,
  generatedAt: "2026-11-19T09:00:00Z",
};

function renderReports({ route = "/reports", saved, schedules, routes = {} }) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    SESSION_KEY,
    makeUser({ roles: ["Requester", "HeadOfUnit"] }),
  );
  const state = { saved, schedules };
  const sent = [];
  const api = installFakeApi(queryClient, {
    "GET /api/reports/catalogue": () => [200, CATALOGUE],
    "GET /api/org/me": () => [
      200,
      {
        departments: [
          {
            id: "d-cp",
            code: "CP",
            name: "Contribution Processing",
            isHod: false,
            isAdmin: false,
            units: [
              {
                id: "u-cm",
                code: "CM",
                name: "Contribution Matching",
                isHead: true,
                isMember: true,
              },
            ],
          },
        ],
      },
    ],
    "POST /api/reports/run": (config) => {
      sent.push(["RUN", config.body]);
      return [200, RESULT];
    },
    "POST /api/reports/saved": (config) => {
      sent.push(["SAVE", config.body]);
      const created = report("r-new", config.body.name, {
        description: config.body.description ?? null,
        share: config.body.share,
        shareRoles: config.body.shareRoles ?? [],
        definition: config.body.definition,
      });
      state.saved = [created, ...state.saved];
      return [200, created];
    },
    "GET /api/reports/saved": () => [200, state.saved],
    "GET /api/reports/schedules": () => [200, state.schedules],
    "POST /api/reports/schedules": (config) => {
      sent.push(["POST", config.body]);
      const report = state.saved.find(
        (r) => r.id === config.body.savedReportId,
      );
      const created = schedule("s-new", report.id, report.name, {
        ...config.body,
        weekDay: config.body.weekDay ?? null,
        dayOfMonth: config.body.dayOfMonth ?? null,
        nextRunAt: "2026-11-23T08:00:00Z",
      });
      state.schedules = [...state.schedules, created];
      return [200, created];
    },
    "PUT /api/reports/schedules/:id": (config) => {
      sent.push(["PUT", config.pathParams.id, config.body]);
      state.schedules = state.schedules.map((s) =>
        s.id === config.pathParams.id
          ? {
              ...s,
              ...config.body,
              weekDay: config.body.weekDay ?? null,
              dayOfMonth: config.body.dayOfMonth ?? null,
              nextRunAt: config.body.enabled ? "2026-11-20T07:00:00Z" : null,
            }
          : s,
      );
      return [200, state.schedules.find((s) => s.id === config.pathParams.id)];
    },
    "DELETE /api/reports/schedules/:id": (config) => {
      sent.push(["DELETE schedule", config.pathParams.id]);
      state.schedules = state.schedules.filter(
        (s) => s.id !== config.pathParams.id,
      );
      return [200, { message: "Schedule deleted." }];
    },
    "DELETE /api/reports/saved/:id": (config) => {
      sent.push(["DELETE report", config.pathParams.id]);
      state.saved = state.saved.filter((r) => r.id !== config.pathParams.id);
      state.schedules = state.schedules.filter(
        (s) => s.savedReportId !== config.pathParams.id,
      );
      return [200, { message: "Report deleted." }];
    },
    ...routes,
  });
  renderWithProviders(<ReportsPage />, { route, queryClient });
  return { sent, api, state };
}

afterEach(() => vi.restoreAllMocks());

describe("Reports: email schedules", () => {
  it("lists schedules with how often, next send in WAT, the last result and its help", async () => {
    renderReports({
      route: "/reports?tab=schedules",
      saved: [report("r-1", "My units"), report("r-2", "Weekly backlog")],
      schedules: [
        schedule("s-1", "r-1", "My units", {
          lastStatus: "Sent",
          lastSentAt: "2026-11-19T07:00:00Z",
        }),
        schedule("s-2", "r-2", "Weekly backlog", {
          frequency: "weekly",
          weekDay: "Monday",
          sendHour: 9,
          format: "csv",
          enabled: false,
          nextRunAt: null,
          lastStatus: "Skipped",
          lastError: "You have no email address.",
        }),
      ],
    });

    const daily = await screen.findByTestId("schedule-My units");
    expect(daily).toHaveTextContent("Every working day at 08:00");
    expect(daily).toHaveTextContent("Excel");
    expect(daily).toHaveTextContent("Fri 20 Nov 2026, 08:00 WAT");
    expect(daily).toHaveTextContent("Sent");
    expect(
      within(daily).getByRole("switch", { name: "Send My units" }),
    ).toHaveAttribute("aria-checked", "true");

    const weekly = screen.getByTestId("schedule-Weekly backlog");
    expect(weekly).toHaveTextContent("Every Monday at 09:00");
    expect(weekly).toHaveTextContent("CSV");
    expect(weekly).toHaveTextContent("Off");
    expect(weekly).toHaveTextContent("Skipped");
    expect(weekly).toHaveTextContent("You have no email address.");
    expect(
      screen.getByText(
        /Sent to you\. Shows only what you are allowed to see\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send now/i }),
    ).not.toBeInTheDocument();
  });

  it("adds a monthly schedule and shows the first send from the response", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({
      route: "/reports?tab=schedules",
      saved: [report("r-1", "My units"), report("r-2", "Weekly backlog")],
      schedules: [schedule("s-1", "r-1", "My units")],
    });
    await screen.findByTestId("schedule-My units");
    await user.click(screen.getByRole("button", { name: "Add schedule" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Email me a report",
    });
    const reportSelect = within(dialog).getByLabelText("Saved report");
    expect(
      within(reportSelect).getByRole("option", {
        name: "My units (already scheduled)",
      }),
    ).toBeDisabled();
    await user.selectOptions(reportSelect, "r-2");
    await user.selectOptions(
      within(dialog).getByLabelText("How often"),
      "monthly",
    );
    expect(
      within(dialog).queryByLabelText("Day of the week"),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Day of the month"),
      "5",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Time (Lagos time)"),
      "7",
    );
    await user.click(within(dialog).getByLabelText("CSV"));
    expect(dialog).toHaveTextContent(
      "Sent to you only. The first email goes out at the next scheduled time after you save.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add schedule" }),
    );

    expect(
      await screen.findByText(
        "The first email goes out Mon 23 Nov 2026, 09:00 WAT.",
      ),
    ).toBeInTheDocument();
    expect(sent[0]).toEqual([
      "POST",
      {
        savedReportId: "r-2",
        frequency: "monthly",
        dayOfMonth: 5,
        sendHour: 7,
        format: "csv",
        enabled: true,
      },
    ]);
    expect(
      await screen.findByTestId("schedule-Weekly backlog"),
    ).toHaveTextContent("Monthly on the 5th at 07:00");
  });

  it("shows the API's message when a save is refused", async () => {
    const user = userEvent.setup();
    renderReports({
      route: "/reports?tab=schedules",
      saved: [report("r-1", "My units")],
      schedules: [],
      routes: {
        "POST /api/reports/schedules": () => [
          409,
          { message: "You have 10 schedules. Delete one first." },
        ],
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Add schedule" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Saved report"),
      "r-1",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add schedule" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have 10 schedules. Delete one first.",
    );
  });

  it("edits weekly with the report locked, switches off from the list, and deletes after confirming", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({
      route: "/reports?tab=schedules",
      saved: [report("r-1", "My units")],
      schedules: [schedule("s-1", "r-1", "My units")],
    });
    await screen.findByTestId("schedule-My units");

    await user.click(screen.getByRole("button", { name: "Edit My units" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Email schedule: My units",
    });
    expect(within(dialog).getByLabelText("Saved report")).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText("How often"),
      "weekly",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Day of the week"),
      "Wednesday",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sent[0]).toEqual([
        "PUT",
        "s-1",
        {
          savedReportId: "r-1",
          frequency: "weekly",
          weekDay: "Wednesday",
          sendHour: 8,
          format: "xlsx",
          enabled: true,
        },
      ]),
    );
    expect(
      await screen.findByText("Every Wednesday at 08:00"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Send My units" }));
    await waitFor(() =>
      expect(sent[1]).toEqual([
        "PUT",
        "s-1",
        expect.objectContaining({ enabled: false, weekDay: "Wednesday" }),
      ]),
    );
    expect(
      await screen.findByText(
        "Switched off. Nothing will be sent until you switch it on.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete My units" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Delete the email for My units?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Schedule deleted.")).toBeInTheDocument();
    expect(sent[2]).toEqual(["DELETE schedule", "s-1"]);
    expect(await screen.findByText(/No report emails yet/)).toBeInTheDocument();
  });
});

describe("Reports: saved reports", () => {
  it("“Email me this report” opens the add dialog with the report chosen, or the existing schedule", async () => {
    const user = userEvent.setup();
    renderReports({
      saved: [
        report("r-1", "My units"),
        report("r-2", "Shared backlog", {
          isMine: false,
          ownerName: "Tunde Ade",
        }),
      ],
      schedules: [schedule("s-1", "r-1", "My units")],
    });
    const shared = await screen.findByTestId("report-Shared backlog");
    expect(shared).toHaveTextContent("Tunde Ade");
    expect(
      within(shared).queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
    await user.click(
      within(shared).getByRole("button", { name: /Email me this report/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Email me a report",
    });
    expect(within(dialog).getByLabelText("Saved report")).toHaveValue("r-2");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const mine = screen.getByTestId("report-My units");
    expect(mine).toHaveTextContent("Every working day at 08:00");
    await user.click(
      within(mine).getByRole("button", { name: /Change email/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Email schedule: My units" }),
    ).toBeInTheDocument();
  });

  it("deleting a saved report refreshes the schedules too", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({
      saved: [report("r-1", "My units")],
      schedules: [schedule("s-1", "r-1", "My units")],
    });
    const row = await screen.findByTestId("report-My units");
    await user.click(
      within(row).getByRole("button", { name: "Delete My units" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete My units?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Delete report" }),
    );
    expect(await screen.findByText("Report deleted.")).toBeInTheDocument();
    expect(sent).toEqual([["DELETE report", "r-1"]]);

    await user.click(screen.getByRole("tab", { name: "Schedules" }));
    expect(await screen.findByText(/No report emails yet/)).toBeInTheDocument();
  });

  it("downloads a saved report as Excel", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click() {
        clicked.push(this.download);
      },
    );
    const formats = [];
    renderReports({
      saved: [report("r-1", "My units")],
      schedules: [],
      routes: {
        "POST /api/reports/saved/:id/export": (config) => {
          formats.push(config.params.format);
          return [
            200,
            new Blob(["x"]),
            {
              "content-disposition":
                'attachment; filename="My units 2026-11-19.xlsx"',
            },
          ];
        },
      },
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Download My units as Excel",
      }),
    );
    expect(
      await screen.findByText("My units 2026-11-19.xlsx downloaded."),
    ).toBeInTheDocument();
    expect(formats).toEqual(["xlsx"]);
    expect(clicked).toEqual(["My units 2026-11-19.xlsx"]);
  });
});

describe("Reports: ready-made reports", () => {
  it("shows the catalogue's cards and runs a definition unchanged, then with other dates", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({ saved: [], schedules: [] });
    const card = await screen.findByTestId("builtin-R1");
    expect(card).toHaveTextContent("Tickets by unit");
    expect(card).toHaveTextContent("Opened and resolved per unit.");
    expect(screen.getByTestId("builtin-R2")).toHaveTextContent(
      "Tickets past their due time.",
    );

    await user.click(
      within(card).getByRole("button", { name: "Run Tickets by unit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Tickets by unit",
    });
    expect(await within(dialog).findByText("Refund")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1,200")).toHaveLength(2);
    expect(within(dialog).getAllByText("87.5%")).toHaveLength(2);
    expect(within(dialog).getByText("Total")).toBeInTheDocument();
    expect(sent[0]).toEqual(["RUN", R1_DEFINITION]);

    const dates = within(dialog).getByLabelText("Dates (Lagos time)");
    expect(dates).toHaveValue("thisMonth");
    await user.selectOptions(dates, "last7");
    await waitFor(() =>
      expect(sent[1]).toEqual([
        "RUN",
        { ...R1_DEFINITION, preset: "last7", from: null, to: null },
      ]),
    );

    await user.selectOptions(dates, "custom");
    await user.click(
      within(dialog).getByRole("button", { name: "Apply dates" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Choose both dates.",
    );
    await user.type(within(dialog).getByLabelText("From"), "2026-10-01");
    await user.type(within(dialog).getByLabelText("To"), "2026-10-31");
    await user.click(
      within(dialog).getByRole("button", { name: "Apply dates" }),
    );
    await waitFor(() =>
      expect(sent[2]).toEqual([
        "RUN",
        {
          ...R1_DEFINITION,
          preset: null,
          from: "2026-10-01",
          to: "2026-10-31",
        },
      ]),
    );
  });

  it("downloads what is on screen through POST /api/reports/export", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exports = [];
    renderReports({
      saved: [],
      schedules: [],
      routes: {
        "POST /api/reports/export": (config) => {
          exports.push([config.params.format, config.body]);
          return [
            200,
            new Blob(["x"]),
            { "content-disposition": 'attachment; filename="R1.csv"' },
          ];
        },
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Run Tickets by unit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Tickets by unit",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Dates (Lagos time)"),
      "today",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Download CSV" }),
    );
    expect(await screen.findByText("R1.csv downloaded.")).toBeInTheDocument();
    expect(exports).toEqual([
      ["csv", { ...R1_DEFINITION, preset: "today", from: null, to: null }],
    ]);
  });

  it("saves the run as my report, shared with roles", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({ saved: [], schedules: [] });
    await user.click(
      await screen.findByRole("button", { name: "Run Tickets by unit" }),
    );
    const run = await screen.findByRole("dialog", { name: "Tickets by unit" });
    await within(run).findByText("Refund");
    await user.click(
      within(run).getByRole("button", { name: "Save as my report" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Save as my report",
    });
    expect(within(dialog).getByLabelText("Name")).toHaveValue(
      "Tickets by unit",
    );
    expect(await within(dialog).findByLabelText("My unit")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Selected roles"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save report" }),
    );
    expect(within(dialog).getByText("Choose at least one role.")).toBeVisible();
    await user.click(within(dialog).getByLabelText("Head of Department"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save report" }),
    );
    expect(
      await screen.findByText("It is in your saved reports."),
    ).toBeInTheDocument();
    expect(sent.find(([kind]) => kind === "SAVE")).toEqual([
      "SAVE",
      {
        name: "Tickets by unit",
        description: "Opened and resolved per unit.",
        definition: R1_DEFINITION,
        share: "roles",
        shareRoles: ["HOD"],
      },
    ]);
  });

  it("“Save and email me this” saves the report, then opens the schedule dialog with it chosen", async () => {
    const user = userEvent.setup();
    const { sent } = renderReports({ saved: [], schedules: [] });
    const card = await screen.findByTestId("builtin-R2");
    await user.click(
      within(card).getByRole("button", { name: /Save and email me this/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Save as my report",
    });
    await user.click(await within(dialog).findByLabelText("My unit"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save and set up email" }),
    );

    const schedule = await screen.findByRole("dialog", {
      name: "Email me a report",
    });
    expect(within(schedule).getByLabelText("Saved report")).toHaveValue(
      "r-new",
    );
    expect(sent[0]).toEqual([
      "SAVE",
      {
        name: "SLA breaches",
        description: "Tickets past their due time.",
        definition: { title: "SLA breaches", mode: "list" },
        share: "unit",
        shareUnitId: "u-cm",
      },
    ]);
    await user.click(
      within(schedule).getByRole("button", { name: "Add schedule" }),
    );
    expect(
      await screen.findByText(/The first email goes out/),
    ).toBeInTheDocument();
    expect(sent[1]).toEqual([
      "POST",
      expect.objectContaining({ savedReportId: "r-new", frequency: "daily" }),
    ]);
  });
});

describe("Reports: run view, charts and saved-report changes", () => {
  const CHART_RESULT = {
    ...RESULT,
    chart: "bar",
    columns: [
      { key: "unit", label: "Unit", type: "text" },
      { key: "count", label: "Count", type: "number" },
      { key: "avg", label: "Average time", type: "hours" },
    ],
    rows: [
      ["IT Support", 12, 4.25],
      ["Refund", 28, 2],
    ],
    totals: ["Total", 40, 3],
    truncated: true,
  };

  it("draws the chart above the table, with a switch for the table only", async () => {
    const user = userEvent.setup();
    renderReports({
      saved: [],
      schedules: [],
      routes: { "POST /api/reports/run": () => [200, CHART_RESULT] },
    });
    await user.click(
      await screen.findByRole("button", { name: "Run Tickets by unit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Tickets by unit",
    });
    const chart = await within(dialog).findByRole("img", {
      name: /Bar chart: Count by Unit/,
    });
    expect(
      within(chart).getByLabelText("Refund, Count: 28"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("cell", { name: "IT Support" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("4.3 h")).toBeInTheDocument();
    expect(within(dialog).getByText("40")).toBeInTheDocument();
    expect(within(dialog).getByText(/Run at 10:00/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Showing the first rows only. Download the file for the full list.",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("switch", { name: "Table only" }),
    );
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("cell", { name: "IT Support" }),
    ).toBeInTheDocument();
  });

  it("says when nothing was found", async () => {
    const user = userEvent.setup();
    renderReports({
      saved: [],
      schedules: [],
      routes: {
        "POST /api/reports/run": () => [
          200,
          { ...RESULT, rows: [], totals: null },
        ],
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Run Tickets by unit" }),
    );
    expect(
      await screen.findByText("Nothing found for this period."),
    ).toBeInTheDocument();
  });

  it("runs a saved report by id; the owner keeps new dates with Save changes", async () => {
    const user = userEvent.setup();
    const runs = [];
    const puts = [];
    const mine = report("r-1", "My units", {
      share: "unit",
      shareUnitId: "u-cm",
      definition: R1_DEFINITION,
    });
    renderReports({
      saved: [mine],
      schedules: [],
      routes: {
        "POST /api/reports/saved/:id/run": (config) => {
          runs.push(config.pathParams.id);
          return [200, RESULT];
        },
        "PUT /api/reports/saved/:id": (config) => {
          puts.push([config.pathParams.id, config.body]);
          return [200, { ...mine, definition: config.body.definition }];
        },
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Run My units" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "My units" });
    await within(dialog).findByText("Refund");
    expect(runs).toEqual(["r-1"]);
    expect(
      within(dialog).queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(dialog).getByLabelText("Dates (Lagos time)"),
      "last7",
    );
    await user.click(
      await within(dialog).findByRole("button", { name: "Save changes" }),
    );
    expect(
      await screen.findByText("The new dates are saved with the report."),
    ).toBeInTheDocument();
    expect(puts).toEqual([
      [
        "r-1",
        {
          name: "My units",
          definition: {
            ...R1_DEFINITION,
            title: "My units",
            preset: "last7",
            from: null,
            to: null,
          },
          share: "unit",
          shareUnitId: "u-cm",
        },
      ],
    ]);
  });

  it("a report shared with me has no Edit, Delete or Save changes", async () => {
    const user = userEvent.setup();
    renderReports({
      saved: [
        report("r-2", "Their report", {
          isMine: false,
          ownerName: "Tunde Ade",
        }),
      ],
      schedules: [],
      routes: { "POST /api/reports/saved/:id/run": () => [200, RESULT] },
    });
    const row = await screen.findByTestId("report-Their report");
    expect(within(row).queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Delete/ })).toBeNull();
    await user.click(
      within(row).getByRole("button", { name: "Run Their report" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Their report" });
    await within(dialog).findByText("Refund");
    await user.selectOptions(
      within(dialog).getByLabelText("Dates (Lagos time)"),
      "today",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("a saved report that answers 404 refreshes the list", async () => {
    const user = userEvent.setup();
    const { state } = renderReports({
      saved: [report("r-1", "Gone report")],
      schedules: [],
      routes: {
        "POST /api/reports/saved/:id/run": () => {
          state.saved = [];
          return [404, { message: "Report not found." }];
        },
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Run Gone report" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Gone report" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Report not found.",
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("report-Gone report"),
      ).not.toBeInTheDocument(),
    );
  });

  it("edits the name and who can see it (PUT), keeping the definition", async () => {
    const user = userEvent.setup();
    const puts = [];
    const mine = report("r-1", "My units", { definition: R1_DEFINITION });
    renderReports({
      saved: [mine],
      schedules: [],
      routes: {
        "PUT /api/reports/saved/:id": (config) => {
          puts.push(config.body);
          return [
            200,
            { ...mine, name: config.body.name, share: "department" },
          ];
        },
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Edit My units" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit My units" });
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Unit totals");
    await user.click(await within(dialog).findByLabelText("My department"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      await screen.findByText("Your changes are saved."),
    ).toBeInTheDocument();
    expect(puts).toEqual([
      {
        name: "Unit totals",
        definition: { ...R1_DEFINITION, title: "Unit totals" },
        share: "department",
        shareDepartmentId: "d-cp",
      },
    ]);
  });

  it("shows a plain message when reports are not for this role (403)", async () => {
    renderReports({
      saved: [],
      schedules: [],
      routes: {
        "GET /api/reports/catalogue": () => [
          403,
          { message: "Reports are for unit heads." },
        ],
        "GET /api/reports/saved": () => [
          403,
          { message: "Reports are for unit heads." },
        ],
      },
    });
    expect(
      await screen.findByRole("heading", {
        name: "Reports are not available for your role.",
      }),
    ).toBeInTheDocument();
  });
});
