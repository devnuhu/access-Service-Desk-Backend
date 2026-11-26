import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import { poolPage } from "@/test/pages";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import WorkQueuePage from "./WorkQueuePage.jsx";

const CP = { id: "d-cp", code: "CP", name: "Contribution Processing" };
const unit = (id, name, flags = {}) => ({
  id,
  code: id,
  name,
  isHead: false,
  isMember: false,
  ...flags,
});
const CM = (flags) => unit("u-cm", "Contribution Matching", flags);
const RF = unit("u-rf", "Refund");
const org = (units, flags = {}) => ({
  departments: [{ ...CP, isHod: false, isAdmin: false, units, ...flags }],
});

const SUMMARY = { open: 9, warning: 2, overdue: 3, farPast: 1, unassigned: 4 };

const CW1 = { userId: "u-cw1", userName: "test.caseworker1", fullName: null };

const item = (reference, status, overrides = {}) => ({
  id: `t-${reference}`,
  reference,
  subject: `Subject ${reference}`,
  departmentCode: "CP",
  categoryName: "Account Reconciliation",
  unitName: "Contribution Matching",
  locationName: "HQ",
  priority: 2,
  status,
  requester: { userId: "u-r", userName: "test.requester", fullName: null },
  assignee: null,
  assignedAt: null,
  firstRespondedAt: null,
  escalatedToHeadAt: null,
  slaLevel: 0,
  slaDueAt: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: null,
  ...overrides,
});

/** `answer(params)` returns the items for a request; every request's params are recorded. */
function renderQueue(roles, me, answer = () => [], search = "", extra = {}) {
  const queryClient = createTestQueryClient();
  const asked = [];
  asked.summary = [];
  installFakeApi(queryClient, {
    "GET /api/tickets/sla-summary": (config) => {
      asked.summary.push(config.params);
      return [200, SUMMARY];
    },
    "GET /api/org/me": () => [200, me],
    "GET /api/pool": (config) => [200, poolPage([], config.params)],
    "GET /api/org/departments": () => [200, []],
    "GET /api/tickets": (config) => {
      asked.push(config.params);
      const result = answer(config.params);
      const items = Array.isArray(result) ? result : result.items;
      const total = Array.isArray(result) ? items.length : result.total;
      return [200, { items, total, page: config.params.page, pageSize: 10 }];
    },
    ...extra,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ roles }));
  const { router } = renderWithProviders(
    <Routes>
      <Route
        path="/departments/:departmentId/tickets"
        element={<WorkQueuePage />}
      />
      <Route path="/no-access" element={<p>No access page</p>} />
      <Route path="/tickets/id/:id" element={<p>Ticket page</p>} />
    </Routes>,
    { route: `/departments/d-cp/tickets${search}`, queryClient },
  );
  asked.router = router;
  return asked;
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("Work queue", () => {
  it("a requester without department access gets the no-access page", async () => {
    const asked = renderQueue(["Requester"], { departments: [] });
    expect(await screen.findByText("No access page")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it("a plain head starts on All open for their own unit: one call, no Admin tab, no unit choice", async () => {
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true }), RF]),
      () => [
        item("CP-2026-000002", 1),
        item("CP-2026-000001", 4, {
          assignee: CW1,
          assignedAt: "2026-11-02T10:00:05Z",
          firstRespondedAt: "2026-11-02T10:30:00Z",
        }),
        item("CP-2026-000003", 2, {
          assignee: CW1,
          assignedAt: "2026-11-03T09:00:00Z",
          escalatedToHeadAt: "2026-11-03T09:40:00Z",
        }),
      ],
    );
    expect(
      await screen.findByRole("tab", { name: "All open" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(tabNames()).toEqual([
      "Assigned to me",
      "All open",
      "Unit pool",
      "My tasks",
    ]);
    expect(screen.queryByLabelText("Unit")).not.toBeInTheDocument();
    expect(
      screen.getByText("Tickets for Contribution Matching."),
    ).toBeInTheDocument();

    const rows = await screen.findAllByTestId(/^ticket-row-/);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      view: "department",
      departmentId: "d-cp",
      unitId: "u-cm",
      open: true,
    });
    expect(asked[0].sort).toBeUndefined();
    expect(asked[0].waitingToStart).toBeUndefined();

    // New: Waiting for an assignee, no first response yet
    expect(within(rows[0]).getByText("Waiting")).toBeInTheDocument();
    expect(within(rows[0]).getByTestId("first-response")).toHaveTextContent(
      "—",
    );
    // Responded
    expect(within(rows[1]).getByTestId("first-response")).toHaveTextContent(
      "Mon 2 Nov 2026, 11:30 WAT",
    );
    // Assigned, no response yet, escalated
    expect(within(rows[2]).getByTestId("first-response")).toHaveTextContent(
      "Waiting",
    );
    expect(within(rows[2]).getByTestId("escalated-badge")).toHaveTextContent(
      "Escalated",
    );
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual([
      // A head can reassign in bulk: the first column ticks rows.
      "",
      "Ticket",
      "Category and unit",
      "Status",
      "Priority",
      "Requester",
      "Assignee",
      "Created",
      "First response",
    ]);
  });

  it("a Department Admin also gets the Admin tab: the whole department, with the unit filter", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit", "DepartmentAdmin"],
      org([CM({ isHead: true, isMember: true }), RF], { isAdmin: true }),
      () => [item("CP-2026-000009", 2, { unitName: "Refund" })],
    );
    await screen.findByRole("tab", { name: "Admin" });
    expect(tabNames()).toEqual([
      "Assigned to me",
      "All open",
      "Unit pool",
      "Admin",
      "My tasks",
    ]);
    await user.click(screen.getByRole("tab", { name: "Admin" }));
    expect(await screen.findByLabelText("Unit")).toHaveDisplayValue(
      "All units",
    );
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        view: "department",
        departmentId: "d-cp",
        open: true,
      }),
    );
    expect(asked.at(-1).unitId).toBeUndefined();
    expect(
      await screen.findByText("Tickets raised to Contribution Processing."),
    ).toBeInTheDocument();
  });

  it("a case worker starts on Assigned to me, longest waiting first (sort=assignedAt), departmentId sent", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
      (params) =>
        params.view === "assigned"
          ? [item("CP-2026-000010", 2, { assignee: CW1 })]
          : [],
    );
    expect(
      await screen.findByRole("tab", { name: "Assigned to me" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findAllByTestId(/^ticket-row-/)).toHaveLength(1);
    expect(screen.getByLabelText("Sort")).toHaveDisplayValue(
      "Longest waiting since assigned",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      view: "assigned",
      departmentId: "d-cp",
      open: true,
      sort: "assignedAt",
    });
    // The page is the unit's, not the department's.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Contribution Matching work queue",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tickets for Contribution Matching."),
    ).toBeInTheDocument();
    // Above the title: the unit, then its department.
    expect(screen.getByTestId("unit-eyebrow")).toHaveTextContent(
      "Contribution Matching · Contribution Processing",
    );
    // All open means all open tickets of their own unit.
    await user.click(screen.getByRole("tab", { name: "All open" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        view: "department",
        departmentId: "d-cp",
        unitId: "u-cm",
      }),
    );
  });

  it("Waiting to start, sort and Escalated go to the server", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [
        item("CP-2026-000020", 2, { assignee: CW1 }),
        item("CP-2026-000021", 6, {
          assignee: CW1,
          escalatedToHeadAt: "2026-11-03T09:40:00Z",
        }),
      ],
    );
    await screen.findAllByTestId(/^ticket-row-/);

    await user.click(screen.getByRole("button", { name: "Waiting to start" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ waitingToStart: true, open: true }),
    );
    expect(
      screen.getByRole("button", { name: "Waiting to start" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.selectOptions(
      screen.getByLabelText("Sort"),
      "Most recently assigned",
    );
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ sort: "assignedAt_desc" }),
    );

    await user.click(screen.getByRole("button", { name: "Escalated" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ escalated: true, open: true }),
    );
  });

  it("opens filtered from a Home card (?tab=assigned&waiting=1)", async () => {
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [],
      "?tab=assigned&status=open&waiting=1",
    );
    expect(
      await screen.findByRole("tab", { name: "Assigned to me" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: "Waiting to start" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({
        view: "assigned",
        waitingToStart: true,
        open: true,
      }),
    );
  });

  it("opens on a unit from the Home overview (?unit=): the HOD gets that unit filtered", async () => {
    const asked = renderQueue(
      ["Requester", "HOD"],
      org([CM(), RF], { isHod: true }),
      () => [],
      "?tab=department&unit=u-rf",
    );
    expect(await screen.findByLabelText("Unit")).toHaveValue("u-rf");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({
        view: "department",
        departmentId: "d-cp",
        unitId: "u-rf",
      }),
    );
  });

  it("a Department Admin asking for another unit opens on the Admin tab with it filtered", async () => {
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit", "DepartmentAdmin"],
      org([CM({ isHead: true, isMember: true }), RF], { isAdmin: true }),
      () => [],
      "?tab=department&unit=u-rf",
    );
    expect(await screen.findByRole("tab", { name: "Admin" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(asked[0]).toMatchObject({ view: "department", unitId: "u-rf" }),
    );
  });

  it("a unit head asking for their own unit opens on All open", async () => {
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [],
      "?tab=department&unit=u-cm",
    );
    expect(
      await screen.findByRole("tab", { name: "All open" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(asked[0]).toMatchObject({ unitId: "u-cm" }));
  });
});

describe("Pending wait chip", () => {
  it("staff lists show the wait on Pending rows (neutral at 4 days), none on others", async () => {
    const at = new Date(Date.now() - 4 * 86_400_000).toISOString();
    renderQueue(
      ["Requester", "HOD"],
      org([CM(), RF], { isHod: true }),
      () => [
        item("CP-2026-000001", 4, { pendingReason: 1, pendingSince: at }),
        item("CP-2026-000002", 2),
      ],
      "?tab=department&unit=u-cm",
    );
    const pending = await screen.findByTestId("ticket-row-CP-2026-000001");
    const chip = within(pending).getByTestId("pending-wait");
    expect(chip).toHaveTextContent("Waiting on requester · 4d");
    expect(chip).toHaveAttribute("data-tone", "neutral");
    expect(
      within(screen.getByTestId("ticket-row-CP-2026-000002")).queryByTestId(
        "pending-wait",
      ),
    ).toBeNull();
  });
});

describe("Priority and age filters", () => {
  const HEAD = ["Requester", "CaseWorker", "HeadOfUnit"];
  const headOrg = () => org([CM({ isHead: true, isMember: true }), RF]);
  const address = (asked) =>
    new URLSearchParams(asked.router.state.location.search);

  it("opens filtered from the dashboard (?priority=3&ageBand=5&open=true) and sends both", async () => {
    const asked = renderQueue(
      HEAD,
      headOrg(),
      () => [],
      "?tab=department&unit=u-cm&open=true&priority=3&ageBand=5",
    );
    expect(await screen.findByLabelText("Priority")).toHaveValue("3");
    expect(screen.getByLabelText("Age")).toHaveValue("5");
    expect(screen.getByLabelText("Age")).toHaveAccessibleDescription(
      "Open tickets only",
    );
    expect(screen.getByLabelText("Status")).toHaveValue("open");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({
        view: "department",
        unitId: "u-cm",
        open: true,
        priority: 3,
        ageBand: 5,
      }),
    );
    expect(asked[0].status).toBeUndefined();
    expect(
      await screen.findByText("No tickets match these filters."),
    ).toBeInTheDocument();
  });

  it("an age in the address wins over a closed status: the list is the open one", async () => {
    const asked = renderQueue(HEAD, headOrg(), () => [], "?status=7&ageBand=1");
    expect(await screen.findByLabelText("Status")).toHaveValue("open");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({ open: true, ageBand: 1 }),
    );
    expect(asked[0].status).toBeUndefined();
  });

  it("the selects write the address and the request; clearing removes them", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(HEAD, headOrg());
    const priority = await screen.findByLabelText("Priority");
    expect(
      within(priority)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All priorities", "Critical", "High", "Medium", "Low"]);
    expect(
      within(screen.getByLabelText("Age"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Any age",
      "Under 1 day",
      "1 to 2 days",
      "3 to 5 days",
      "6 to 10 days",
      "Over 10 days",
    ]);

    await user.selectOptions(priority, "Critical");
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ priority: 4 }));
    expect(address(asked).get("priority")).toBe("4");

    await user.selectOptions(screen.getByLabelText("Age"), "6 to 10 days");
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        priority: 4,
        ageBand: 4,
        open: true,
      }),
    );
    expect(address(asked).get("ageBand")).toBe("4");
    expect(address(asked).get("open")).toBe("true");

    // Back to filters already asked for: the cached list shows (no new request).
    await user.selectOptions(priority, "All priorities");
    await user.selectOptions(screen.getByLabelText("Age"), "Any age");
    expect(priority).toHaveValue("");
    expect(screen.getByLabelText("Age")).toHaveValue("");
    const after = address(asked);
    expect(after.has("priority")).toBe(false);
    expect(after.has("ageBand")).toBe(false);
    expect(after.has("open")).toBe(false);
  });

  it("choosing an age sets the status to Open; another status clears the age", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(HEAD, headOrg(), () => [], "?status=2");
    const status = await screen.findByLabelText("Status");
    expect(status).toHaveValue("2");

    await user.selectOptions(screen.getByLabelText("Age"), "Under 1 day");
    expect(status).toHaveValue("open");
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ open: true, ageBand: 1 }),
    );
    expect(asked.at(-1).status).toBeUndefined();
    expect(address(asked).has("status")).toBe(false);

    await user.selectOptions(status, "Resolved");
    expect(screen.getByLabelText("Age")).toHaveValue("");
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ status: 5 }));
    expect(asked.at(-1).ageBand).toBeUndefined();
    expect(address(asked).has("ageBand")).toBe(false);
  });

  it("Assigned to me has them too", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
    );
    expect(
      await screen.findByRole("tab", { name: "Assigned to me" }),
    ).toHaveAttribute("aria-selected", "true");
    await user.selectOptions(screen.getByLabelText("Priority"), "High");
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ view: "assigned", priority: 3 }),
    );
  });
});

describe("SLA", () => {
  const counts = () =>
    Object.fromEntries(
      [...screen.getByTestId("sla-summary").children].map((card) => [
        card.children[0].textContent,
        card.children[1].textContent,
      ]),
    );

  it("a unit head gets their unit's counts; Overdue and Unassigned filter on the server", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true }), RF]),
    );
    await waitFor(() =>
      expect(counts()).toEqual({
        Open: "9",
        Warning: "2",
        Overdue: "3",
        "Far past": "1",
        Unassigned: "4",
      }),
    );
    expect(asked.summary).toEqual([{ departmentId: "d-cp", unitId: "u-cm" }]);

    const summary = screen.getByTestId("sla-summary");
    await user.click(within(summary).getByRole("button", { name: /Overdue/ }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        view: "department",
        unitId: "u-cm",
        slaBreached: true,
        open: true,
      }),
    );
    expect(screen.getByRole("button", { name: "Overdue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(
      within(summary).getByRole("button", { name: /Unassigned/ }),
    );
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ status: 1 }));
    expect(asked.at(-1).open).toBeUndefined();
    expect(screen.getByLabelText("Status")).toHaveDisplayValue("New");
  });

  it("the HOD sees the whole department's counts (no unitId)", async () => {
    const asked = renderQueue(
      ["Requester", "HOD"],
      org([CM(), RF], { isHod: true }),
    );
    await screen.findByTestId("sla-summary");
    await waitFor(() => expect(asked.summary).toHaveLength(1));
    expect(asked.summary[0]).toEqual({ departmentId: "d-cp" });
  });

  it("the Admin tab counts the whole department", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit", "DepartmentAdmin"],
      org([CM({ isHead: true, isMember: true }), RF], { isAdmin: true }),
    );
    await user.click(await screen.findByRole("tab", { name: "Admin" }));
    await waitFor(() =>
      expect(asked.summary.at(-1)).toEqual({ departmentId: "d-cp" }),
    );
  });

  it("a case worker gets no counts; the Overdue chip works on Assigned to me", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
    );
    await user.click(await screen.findByRole("button", { name: "Overdue" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        view: "assigned",
        slaBreached: true,
      }),
    );
    expect(screen.queryByTestId("sla-summary")).not.toBeInTheDocument();
    expect(asked.summary).toHaveLength(0);
  });

  it("rows show Warning, Overdue and Far past; nothing while on track", async () => {
    renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [
        item("CP-2026-000030", 3, { assignee: CW1, slaLevel: 0 }),
        item("CP-2026-000031", 3, { assignee: CW1, slaLevel: 1 }),
        item("CP-2026-000032", 3, { assignee: CW1, slaLevel: 2 }),
        item("CP-2026-000033", 3, { assignee: CW1, slaLevel: 3 }),
      ],
    );
    const rows = await screen.findAllByTestId(/^ticket-row-/);
    expect(within(rows[0]).queryByTestId("sla-badge")).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId("sla-badge")).toHaveTextContent(
      "Warning",
    );
    expect(within(rows[2]).getByTestId("sla-badge")).toHaveTextContent(
      "Overdue",
    );
    expect(within(rows[3]).getByTestId("sla-badge")).toHaveTextContent(
      "Far past",
    );
  });
});

describe("Due time (slaDueAt)", () => {
  // Now: Tue 17 Nov 2026, 10:00 WAT (09:00 UTC).
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-11-17T09:00:00Z"),
      toFake: ["Date"],
    });
  });
  afterEach(() => vi.useRealTimers());

  const rows = () => [
    item("CP-2026-000040", 3, {
      assignee: CW1,
      slaDueAt: "2026-11-19T13:00:00Z",
    }),
    item("CP-2026-000041", 3, {
      assignee: CW1,
      slaDueAt: "2026-11-17T13:00:00Z",
    }),
    item("CP-2026-000042", 4, { assignee: CW1, slaDueAt: null }),
    item("CP-2026-000043", 6, {
      assignee: CW1,
      slaLevel: 2,
      slaDueAt: "2026-11-17T07:30:00Z",
    }),
    item("CP-2026-000044", 3, {
      assignee: CW1,
      slaDueAt: "2026-11-18T08:30:00",
    }),
  ];

  it("rows show the due time in WAT, Overdue since once passed, nothing when null", async () => {
    renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      rows,
    );
    await screen.findAllByTestId(/^ticket-row-/);
    const due = (ref) =>
      within(screen.getByTestId(`ticket-row-${ref}`)).queryByTestId("due");
    expect(due("CP-2026-000040")).toHaveTextContent("Due Thu 19 Nov, 14:00");
    expect(due("CP-2026-000041")).toHaveTextContent("Due Today 14:00");
    expect(due("CP-2026-000042")).not.toBeInTheDocument();
    expect(due("CP-2026-000043")).toHaveTextContent(
      "Overdue since Today 08:30",
    );
    // the SLA chip still comes from slaLevel
    expect(
      within(screen.getByTestId("ticket-row-CP-2026-000043")).getByTestId(
        "sla-badge",
      ),
    ).toHaveTextContent("Overdue");
    // a time without a zone is UTC
    expect(due("CP-2026-000044")).toHaveTextContent("Due Tomorrow 09:30");
  });

  it("Due soonest sends sort=due, goes back to page 1, keeps the filters, and shows the page as the server sent it", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      // 25 matches; each page is the same five rows, in the server's order.
      () => ({ items: rows(), total: 25 }),
    );
    await screen.findAllByTestId(/^ticket-row-/);
    await user.click(screen.getByRole("button", { name: "Overdue" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ page: 2 }));

    await user.selectOptions(screen.getByLabelText("Sort"), "Due soonest");
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        sort: "due",
        slaBreached: true,
        page: 1,
        pageSize: 10,
      }),
    );
    // Rendered as returned: no re-sorting by slaDueAt on screen (the order would be 43, 41, 44, 40, 42).
    expect(
      screen
        .getAllByTestId(/^ticket-row-/)
        .map((row) => row.dataset.testid.slice("ticket-row-".length)),
    ).toEqual(rows().map((t) => t.reference));
    expect(screen.queryByText(/orders the tickets of this page/)).toBeNull();
  });
});

describe("Unit pool", () => {
  const POOL = [
    {
      id: "t-1",
      reference: "CP-2026-000101",
      unitId: "u-cm",
      unitName: "Contribution Matching",
      categoryId: "c-1",
      categoryName: "Account Reconciliation",
      priority: 3,
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
    {
      id: "t-2",
      reference: "CP-2026-000102",
      unitId: "u-cm",
      unitName: "Contribution Matching",
      categoryId: "c-2",
      categoryName: "Refund Request",
      priority: 2,
      createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    },
    // Another department's unit: not shown in this queue.
    {
      id: "t-9",
      reference: "IT-2026-000001",
      unitId: "u-other",
      unitName: "IT Support",
      categoryId: "c-9",
      categoryName: "Laptop",
      priority: 1,
      createdAt: new Date().toISOString(),
    },
  ];
  const member = () => org([CM({ isMember: true }), RF]);

  function renderPool(pick, rows = POOL, me = member()) {
    let pool = [...rows];
    const calls = { pool: 0, pick: [], asked: [] };
    renderQueue(["Requester", "CaseWorker"], me, () => [], "?tab=pool", {
      "GET /api/pool": (config) => {
        calls.pool += 1;
        calls.asked.push(config.params);
        return [200, poolPage(pool, config.params)];
      },
      "POST /api/tickets/:ticketId/pick": (config) => {
        calls.pick.push(config.pathParams.ticketId);
        const [status, body, drop] = pick(config.pathParams.ticketId);
        if (drop) pool = pool.filter((t) => t.id !== drop);
        return [status, body];
      },
    });
    return calls;
  }

  const many = (unitId, unitName, count, from = 1) =>
    Array.from({ length: count }, (_, i) => ({
      id: `t-${unitId}-${i + from}`,
      reference: `CP-2026-${String(500 + i + from).padStart(6, "0")}`,
      subject: `Pool subject ${i + from}`,
      unitId,
      unitName,
      categoryId: "c-1",
      categoryName: "Account Reconciliation",
      priority: 2,
      createdAt: "2026-11-20T09:00:00Z",
    }));

  it("pages the pool on the server (10 a page, the server's total), shows the subject, and a search goes back to page 1", async () => {
    const user = userEvent.setup();
    const calls = renderPool(
      () => [200, { message: "ok" }],
      [...many("u-cm", "Contribution Matching", 23), ...POOL.slice(2)],
    );
    const panel = await screen.findByTestId("pool-panel");
    expect(await within(panel).findByTestId("pager-summary")).toHaveTextContent(
      "Showing 1-10 of 23",
    );
    expect(within(panel).getAllByTestId("pool-subject")[0]).toHaveTextContent(
      "Pool subject 1",
    );
    // The tab's badge is the server's count for this department's units (one row asked for).
    expect(screen.getByTestId("pool-count")).toHaveTextContent("23");
    expect(calls.asked[0]).toEqual({ page: 1, pageSize: 1 });
    // Another department's unit is in the person's pool: a unit is always sent here.
    expect(calls.asked.at(-1)).toEqual({
      unitId: "u-cm",
      page: 1,
      pageSize: 10,
    });

    await user.click(within(panel).getByRole("button", { name: "Page 3" }));
    expect(
      await within(panel).findByText("Showing 21-23 of 23"),
    ).toBeInTheDocument();
    await user.type(
      within(panel).getByLabelText("Search the pool"),
      "subject 2",
    );
    await waitFor(() =>
      expect(calls.asked.at(-1)).toEqual({
        search: "subject 2",
        unitId: "u-cm",
        page: 1,
        pageSize: 10,
      }),
    );
    // "subject 2", "subject 20" to "subject 23": 5 matches, page 1.
    expect(
      await within(panel).findByText("Showing 1-5 of 5"),
    ).toBeInTheDocument();
  });

  it("a head of two units here gets unit chips from the server's counts; a chip sends its unitId", async () => {
    const user = userEvent.setup();
    const calls = renderPool(
      () => [200, { message: "ok" }],
      [
        ...many("u-cm", "Contribution Matching", 2),
        ...many("u-rf", "Refund", 1, 3),
      ],
      org([
        CM({ isHead: true, isMember: true }),
        unit("u-rf", "Refund", { isHead: true }),
      ]),
    );
    const chips = await screen.findByTestId("pool-units");
    expect(
      within(chips)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["All units", "Contribution Matching2", "Refund1"]);
    expect(
      within(chips).getByRole("button", { name: "All units" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(calls.asked.at(-1)).toEqual({ page: 1, pageSize: 10 });

    await user.click(within(chips).getByRole("button", { name: /Refund/ }));
    await waitFor(() =>
      expect(calls.asked.at(-1)).toEqual({
        unitId: "u-rf",
        page: 1,
        pageSize: 10,
      }),
    );
    expect(
      await screen.findByTestId("pool-CP-2026-000503"),
    ).toBeInTheDocument();
  });

  it("lists this department's pool, oldest first, with a count on the tab", async () => {
    renderPool(() => [200, { message: "ok" }]);
    const first = await screen.findByTestId("pool-CP-2026-000101");
    expect(first).toHaveTextContent("Account Reconciliation");
    expect(first).toHaveTextContent("High");
    expect(first).toHaveTextContent("2 hours");
    expect(screen.getByTestId("pool-CP-2026-000102")).toHaveTextContent(
      "20 minutes",
    );
    expect(screen.queryByText("IT-2026-000001")).not.toBeInTheDocument();
    expect(screen.getByTestId("pool-count")).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Unit pool/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Pick takes the ticket, shows the message and opens it", async () => {
    const user = userEvent.setup();
    const calls = renderPool(() => [
      200,
      { message: "CP-2026-000101 is now assigned to you." },
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Pick CP-2026-000101" }),
    );
    expect(await screen.findByText("Ticket page")).toBeInTheDocument();
    expect(
      screen.getByText("CP-2026-000101 is now assigned to you."),
    ).toBeInTheDocument();
    expect(calls.pick).toEqual(["t-1"]);
  });

  it("on 409 says someone else took it and refreshes the pool", async () => {
    const user = userEvent.setup();
    const calls = renderPool((id) => [
      409,
      { message: "This ticket has already been taken." },
      id,
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Pick CP-2026-000101" }),
    );
    expect(
      await screen.findByText("Someone else took it."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByTestId("pool-CP-2026-000101"),
      ).not.toBeInTheDocument(),
    );
    expect(calls.pool).toBeGreaterThan(1);
    expect(screen.queryByText("Ticket page")).not.toBeInTheDocument();
  });

  it("shows the server's message on 403", async () => {
    const user = userEvent.setup();
    renderPool(() => [403, { message: "You do not handle this category." }]);
    await user.click(
      await screen.findByRole("button", { name: "Pick CP-2026-000102" }),
    );
    expect(
      await screen.findByText("You do not handle this category."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pool-CP-2026-000102")).toBeInTheDocument();
  });

  it("no unit, no pool: the HOD gets no tabs and the pool is never asked for", async () => {
    let asked = 0;
    renderQueue(
      ["Requester", "HOD"],
      org([CM(), RF], { isHod: true }),
      () => [],
      "?tab=pool",
      {
        "GET /api/pool": (config) => {
          asked += 1;
          return [200, poolPage(POOL, config.params)];
        },
      },
    );
    expect(await screen.findByLabelText("Unit")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Unit pool/ })).toBeNull();
    expect(asked).toBe(0);
  });
});

const poolItem = (reference) => ({
  id: `t-${reference}`,
  reference,
  unitId: "u-cm",
  unitName: "Contribution Matching",
  categoryId: "c-1",
  categoryName: "Account Reconciliation",
  priority: 2,
  createdAt: "2026-11-03T10:00:00Z",
});

describe("Work queue tools", () => {
  it("shows unread, comments, files and Requester replied from the list fields", async () => {
    renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [
        item("CP-2026-000040", 3, {
          assignee: CW1,
          unread: true,
          commentCount: 3,
          attachmentCount: 0,
          lastCommentAt: "2026-11-03T11:00:00Z",
          lastCommentByRequester: true,
        }),
        item("CP-2026-000041", 3, {
          assignee: CW1,
          commentCount: 0,
          attachmentCount: 2,
        }),
      ],
    );
    const unread = await screen.findByTestId("ticket-row-CP-2026-000040");
    expect(unread).toHaveAttribute("data-unread", "true");
    expect(within(unread).getByTestId("unread-dot")).toBeInTheDocument();
    expect(within(unread).getByText("Subject CP-2026-000040")).toHaveClass(
      "font-bold",
    );
    expect(within(unread).getByTestId("comment-count")).toHaveTextContent("3");
    expect(within(unread).queryByTestId("attachment-count")).toBeNull();
    expect(within(unread).getByTestId("requester-replied")).toHaveAttribute(
      "title",
      expect.stringMatching(/^Last comment /),
    );

    const read = screen.getByTestId("ticket-row-CP-2026-000041");
    expect(read).not.toHaveAttribute("data-unread");
    expect(within(read).queryByTestId("unread-dot")).toBeNull();
    expect(within(read).queryByTestId("comment-count")).toBeNull();
    expect(within(read).getByTestId("attachment-count")).toHaveTextContent("2");
    expect(within(read).queryByTestId("requester-replied")).toBeNull();
  });

  it("saves the filters as a view, applies views, favourites and deletes one", async () => {
    const user = userEvent.setup();
    let views = [];
    const calls = [];
    const asked = renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
      () => [],
      "",
      {
        "GET /api/views": () => [200, views],
        "POST /api/views": ({ body }) => {
          calls.push(["POST", body]);
          const view = {
            id: "v-1",
            ...body,
            isFavourite: false,
            createdAt: "2026-11-21T09:00:00Z",
          };
          views = [view];
          return [200, view];
        },
        "PATCH /api/views/:viewId": ({ body, pathParams }) => {
          calls.push(["PATCH", pathParams.viewId, body]);
          views = views.map((v) => ({ ...v, ...body }));
          return [200, views[0]];
        },
        "DELETE /api/views/:viewId": ({ pathParams }) => {
          calls.push(["DELETE", pathParams.viewId]);
          views = [];
          return [200, { message: "View deleted." }];
        },
      },
    );
    await screen.findByRole("tab", { name: "Assigned to me" });
    await user.click(screen.getByRole("button", { name: "Escalated" }));

    // Save what is on screen.
    await user.click(screen.getByRole("button", { name: /^Views/ }));
    await user.click(
      screen.getByRole("button", { name: /Save current filters as view/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Save current filters as a view",
    });
    await user.type(within(dialog).getByLabelText("Name"), "My escalated");
    await user.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][1].name).toBe("My escalated");
    expect(JSON.parse(calls[0][1].filterJson)).toEqual({
      tab: "assigned",
      open: true,
      escalated: true,
    });
    expect(
      await screen.findByRole("button", { name: /Views: My escalated/ }),
    ).toBeInTheDocument();

    // A built-in view sets the filters: Unassigned is the unit's New tickets.
    await user.click(screen.getByRole("button", { name: /^Views/ }));
    await user.click(screen.getByRole("button", { name: "Unassigned" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        view: "department",
        unitId: "u-cm",
        status: 1,
      }),
    );
    expect(asked.at(-1).escalated).toBeUndefined();
    expect(screen.getByRole("tab", { name: "All open" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // My saved view puts its filters back (that list is cached from before, so no new call).
    await user.click(screen.getByRole("button", { name: /^Views/ }));
    await user.click(screen.getByRole("button", { name: "My escalated" }));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Assigned to me" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByRole("button", { name: "Escalated" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Views: My escalated/ }),
    ).toBeInTheDocument();

    // Star it, then delete it.
    await user.click(screen.getByRole("button", { name: /^Views/ }));
    await user.click(
      screen.getByRole("button", { name: "Favourite My escalated" }),
    );
    await waitFor(() =>
      expect(calls.at(-1)).toEqual(["PATCH", "v-1", { isFavourite: true }]),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete My escalated" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Delete My escalated?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.at(-1)).toEqual(["DELETE", "v-1"]));
  });

  it("shows a name already used (409) on the name field", async () => {
    const user = userEvent.setup();
    renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
      () => [],
      "",
      {
        "GET /api/views": () => [200, []],
        "POST /api/views": () => [
          409,
          { message: "You already have a view called Mine." },
        ],
      },
    );
    await screen.findByRole("tab", { name: "Assigned to me" });
    await user.click(screen.getByRole("button", { name: /^Views/ }));
    await user.click(
      screen.getByRole("button", { name: /Save current filters as view/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Save current filters as a view",
    });
    const name = within(dialog).getByLabelText("Name");
    await user.type(name, "Mine");
    await user.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(name).toHaveAccessibleDescription(
      "You already have a view called Mine.",
    );
  });

  it("bulk pick: a mixed result shows the summary, refreshes and clears the selection", async () => {
    const user = userEvent.setup();
    const sent = [];
    let poolCalls = 0;
    renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true })]),
      () => [],
      "?tab=pool",
      {
        "GET /api/pool": (config) => {
          poolCalls += 1;
          return [
            200,
            poolPage(
              [
                poolItem("CP-2026-000031"),
                poolItem("CP-2026-000032"),
                poolItem("CP-2026-000033"),
              ],
              config.params,
            ),
          ];
        },
        "POST /api/tickets/bulk/pick": ({ body }) => {
          sent.push(body);
          return [
            200,
            {
              total: 3,
              succeeded: 2,
              failed: 1,
              items: [
                {
                  ticketId: "t-CP-2026-000031",
                  reference: "CP-2026-000031",
                  ok: true,
                  status: 200,
                  message: "Done.",
                },
                {
                  ticketId: "t-CP-2026-000032",
                  reference: "CP-2026-000032",
                  ok: true,
                  status: 200,
                  message: "Done.",
                },
                {
                  ticketId: "t-CP-2026-000033",
                  reference: "CP-2026-000033",
                  ok: false,
                  status: 409,
                  message: "Someone else has already taken this ticket.",
                },
              ],
            },
          ];
        },
      },
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Select every ticket on this page",
      }),
    );
    const bar = screen.getByRole("region", { name: "Selected tickets" });
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();
    const before = poolCalls;
    await user.click(within(bar).getByRole("button", { name: "Pick" }));

    const summary = await screen.findByRole("dialog", {
      name: "2 done, 1 not done",
    });
    expect(sent).toEqual([
      {
        ticketIds: ["t-CP-2026-000031", "t-CP-2026-000032", "t-CP-2026-000033"],
      },
    ]);
    expect(
      within(summary).getByTestId("bulk-failed-CP-2026-000033"),
    ).toHaveTextContent("Someone else has already taken this ticket.");
    expect(within(summary).queryByText("CP-2026-000031")).toBeNull();
    // Not an error: no alert toast, the list refreshed, nothing ticked any more.
    await waitFor(() => expect(poolCalls).toBeGreaterThan(before));
    expect(
      screen.queryByRole("region", { name: "Selected tickets" }),
    ).not.toBeInTheDocument();
  });
});

describe("Work queue: merge two tickets", () => {
  it("offers Merge only for exactly two tickets of one unit, the first into the second", async () => {
    const user = userEvent.setup();
    renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true })]),
      () => [
        item("CP-2026-000050", 3, { assignee: CW1 }),
        item("CP-2026-000051", 3, { assignee: CW1 }),
        item("CP-2026-000052", 3, { assignee: CW1 }),
      ],
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Select CP-2026-000050" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Select CP-2026-000051" }),
    );
    const bar = screen.getByRole("region", { name: "Selected tickets" });
    await user.click(within(bar).getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Merge CP-2026-000050 into another ticket",
    });
    expect(
      within(dialog).getByLabelText("Reference of the ticket to keep"),
    ).toHaveValue("CP-2026-000051");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // A third ticket: no Merge.
    await user.click(
      screen.getByRole("checkbox", { name: "Select CP-2026-000052" }),
    );
    expect(
      within(
        screen.getByRole("region", { name: "Selected tickets" }),
      ).queryByRole("button", { name: "Merge" }),
    ).not.toBeInTheDocument();
  });
});

describe("Work queue: 10 per page, search on the server", () => {
  it("asks for 10 rows, shows the pager from the server's total, and a search goes back to page 1", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      org([CM({ isHead: true, isMember: true }), RF]),
      () => ({ items: [item("CP-2026-000001", 3)], total: 134 }),
    );
    expect(await screen.findByTestId("pager-summary")).toHaveTextContent(
      "Showing 1-10 of 134",
    );
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ page: 1, pageSize: 10 }),
    );
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({ page: 2, pageSize: 10 }),
    );
    expect(screen.getByTestId("pager-summary")).toHaveTextContent(
      "Showing 11-20 of 134",
    );
    await user.type(
      screen.getByLabelText("Search by reference, subject or description"),
      "refund",
    );
    await waitFor(() =>
      expect(asked.at(-1)).toMatchObject({
        search: "refund",
        page: 1,
        pageSize: 10,
      }),
    );
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Work queue: My tasks", () => {
  const GIVER = {
    userId: "u-cw1",
    userName: "test.caseworker1",
    fullName: "Chidi Worker",
  };
  const myTask = (id, overrides = {}) => ({
    taskId: id,
    ticketId: `t-${id}`,
    ticketReference: `CP-2026-00000${id.slice(-1)}`,
    ticketSubject: `Subject ${id}`,
    ticketStatus: 3,
    title: `Task ${id}`,
    status: "Open",
    dueDate: null,
    isOverdue: false,
    givenBy: GIVER,
    finishedAt: null,
    reason: null,
    createdAt: "2026-11-03T10:00:00Z",
    ...overrides,
  });
  const COUNTS = { open: 3, done: 2, rejected: 1, cancelled: 1, all: 7 };
  /**
   * `answer(params)` gives the items; `counts(params)` the chips' counts (inside the date window);
   * openCount stays 3 whatever is asked, as the API does. A [status, body] answer is sent as is.
   */
  function renderTasks(answer, { counts = () => COUNTS } = {}) {
    const asked = [];
    const queue = renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true }), RF]),
      () => [],
      "?tab=tasks",
      {
        "GET /api/tasks/mine": (config) => {
          asked.push(config.params);
          const result = answer(config.params);
          if (!Array.isArray(result) || typeof result[0] === "number")
            return result;
          return [
            200,
            {
              items: result,
              total: result.length,
              openCount: 3,
              counts: counts(config.params),
              page: config.params.page ?? 1,
              pageSize: config.params.pageSize ?? 20,
            },
          ];
        },
      },
    );
    return { asked, queue };
  }
  const listCalls = (asked) => asked.filter((p) => p.pageSize !== 1);

  it("shows the open count as the tab's badge, and open tasks with ticket, giver, due date and Overdue", async () => {
    const { asked, queue } = renderTasks(() => [
      myTask("k-1", { dueDate: "2026-11-10", isOverdue: true }),
      myTask("k-2", { dueDate: "2026-12-20" }),
      myTask("k-3", { givenBy: null }),
    ]);
    const tab = await screen.findByRole("tab", { name: /My tasks/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await within(tab).findByTestId("my-tasks-count")).toHaveTextContent(
      "3",
    );

    const first = await screen.findByTestId("my-task-k-1");
    expect(first).toHaveTextContent("Task k-1");
    expect(first).toHaveTextContent("CP-2026-000001");
    expect(first).toHaveTextContent("Subject k-1");
    expect(within(first).getByTestId("my-task-given-by")).toHaveTextContent(
      "Chidi Worker",
    );
    expect(within(first).getByTestId("my-task-due")).toHaveTextContent(
      "Overdue · 10 Nov",
    );
    expect(within(first).getByTestId("task-status")).toHaveTextContent("Open");
    expect(
      within(screen.getByTestId("my-task-k-2")).getByTestId("my-task-due"),
    ).toHaveTextContent("Due 20 Dec");
    expect(
      within(screen.getByTestId("my-task-k-3")).getByTestId("my-task-due"),
    ).toHaveTextContent("No due date");
    // Open tasks have no Finished or Reason column.
    expect(screen.queryByRole("columnheader", { name: "Finished" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Reason" })).toBeNull();

    // Open by default, 10 a page, no date window; the badge asks for one row.
    expect(listCalls(asked)).toEqual([
      { status: "open", page: 1, pageSize: 10 },
    ]);
    expect(asked).toContainEqual({ page: 1, pageSize: 1 });
    // The tab asks for no ticket list.
    expect(queue).toHaveLength(0);

    const user = userEvent.setup();
    await user.click(within(first).getByRole("link", { name: "Task k-1" }));
    expect(queue.router.state.location.pathname).toBe(
      "/tickets/CP-2026-000001",
    );
  });

  it("the status chips carry the server's counts; choosing one asks for it, and finished rows show when and why", async () => {
    const user = userEvent.setup();
    const { asked } = renderTasks((params) =>
      params.status === "rejected"
        ? [
            myTask("k-4", {
              status: "Rejected",
              dueDate: "2026-11-10",
              finishedAt: "2026-11-24T09:00:00Z",
              reason: "Records holds this, not us.",
            }),
          ]
        : [myTask("k-1")],
    );
    await screen.findByTestId("my-task-k-1");
    const chip = (status) => screen.getByTestId(`my-tasks-chip-${status}`);
    expect(chip("open")).toHaveAttribute("aria-pressed", "true");
    expect(
      ["open", "done", "rejected", "cancelled", "all"].map(
        (s) => chip(s).textContent,
      ),
    ).toEqual(["Open3", "Done2", "Rejected1", "Cancelled1", "All7"]);

    await user.click(chip("rejected"));
    const row = await screen.findByTestId("my-task-k-4");
    expect(chip("rejected")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("columnheader", { name: "Finished" }),
    ).toBeInTheDocument();
    expect(within(row).getByTestId("my-task-finished")).toHaveTextContent(
      "24 Nov 2026, 10:00",
    );
    expect(within(row).getByTestId("my-task-reason")).toHaveTextContent(
      "Records holds this, not us.",
    );
    // A finished task's due date is plain (no Overdue).
    expect(within(row).getByTestId("my-task-due")).toHaveTextContent("10 Nov");
    expect(within(row).getByTestId("my-task-due")).not.toHaveTextContent(
      "Overdue",
    );
    expect(within(row).getByTestId("task-status")).toHaveTextContent(
      "Rejected",
    );
    expect(listCalls(asked).at(-1)).toEqual({
      status: "rejected",
      page: 1,
      pageSize: 10,
    });
  });

  it("All keeps done, rejected and cancelled tasks in the list next to open ones", async () => {
    const user = userEvent.setup();
    renderTasks((params) =>
      params.status === "all"
        ? [
            myTask("k-1"),
            myTask("k-2", {
              status: "Done",
              finishedAt: "2026-11-20T09:00:00Z",
            }),
            myTask("k-3", {
              status: "Cancelled",
              finishedAt: "2026-11-21T09:00:00Z",
              reason: "Sorted by phone.",
            }),
          ]
        : [myTask("k-1")],
    );
    await screen.findByTestId("my-task-k-1");
    await user.click(screen.getByTestId("my-tasks-chip-all"));
    expect(await screen.findByTestId("my-task-k-3")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-task-k-2")).getByTestId("my-task-reason"),
    ).toHaveTextContent("—");
    // The open row in All has no finish time or reason.
    expect(
      within(screen.getByTestId("my-task-k-1")).getByTestId("my-task-finished"),
    ).toHaveTextContent("—");
  });

  it("the date window (type, From, To) goes to the server and the counts follow it; Clear removes it", async () => {
    const user = userEvent.setup();
    const { asked } = renderTasks(() => [myTask("k-1")], {
      counts: (params) =>
        params.from
          ? { open: 1, done: 0, rejected: 0, cancelled: 0, all: 1 }
          : COUNTS,
    });
    await screen.findByTestId("my-task-k-1");
    await user.selectOptions(screen.getByLabelText("Date"), "due");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-11-30" },
    });
    await waitFor(() =>
      expect(listCalls(asked).at(-1)).toEqual({
        status: "open",
        dateField: "due",
        from: "2026-11-01",
        to: "2026-11-30",
        page: 1,
        pageSize: 10,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("my-tasks-chip-all")).toHaveTextContent("All1"),
    );

    // Clear goes back to the list without dates (here from the cache: it was asked for first).
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(screen.getByTestId("my-tasks-chip-all")).toHaveTextContent("All7"),
    );
    expect(screen.getByLabelText("From")).toHaveValue("");
    expect(screen.getByLabelText("Date")).toHaveValue("given");
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows the API's date error (400 errors.from)", async () => {
    renderTasks((params) =>
      params.from === "2026-12-01"
        ? [
            400,
            {
              message: "From must not be after To.",
              errors: { from: "From must not be after To." },
            },
          ]
        : [myTask("k-1")],
    );
    await screen.findByTestId("my-task-k-1");
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-11-30" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-12-01" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "From must not be after To.",
    );
    expect(screen.getByLabelText("From")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it('says "No tasks are waiting for you." when nothing is open, and the badge hides at 0', async () => {
    renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true }), RF]),
      () => [],
      "?tab=tasks",
      {
        "GET /api/tasks/mine": (config) => [
          200,
          {
            items: [],
            total: 0,
            openCount: 0,
            counts: { open: 0, done: 0, rejected: 0, cancelled: 0, all: 0 },
            page: 1,
            pageSize: config.params.pageSize,
          },
        ],
      },
    );
    expect(
      await screen.findByText("No tasks are waiting for you."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("my-tasks-count")).toBeNull();
  });

  it("pages with the shared pager from the server's total", async () => {
    const user = userEvent.setup();
    const asked = [];
    renderQueue(
      ["Requester", "CaseWorker"],
      org([CM({ isMember: true }), RF]),
      () => [],
      "?tab=tasks",
      {
        "GET /api/tasks/mine": (config) => {
          asked.push(config.params);
          const page = config.params.page ?? 1;
          return [
            200,
            {
              items: [myTask(`p${page}`)],
              total: 23,
              openCount: 23,
              counts: { ...COUNTS, open: 23 },
              page,
              pageSize: 10,
            },
          ];
        },
      },
    );
    expect(await screen.findByTestId("pager-summary")).toHaveTextContent(
      "Showing 1-10 of 23",
    );
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    expect(await screen.findByTestId("my-task-p2")).toBeInTheDocument();
    expect(asked).toContainEqual({ status: "open", page: 2, pageSize: 10 });
  });
});
