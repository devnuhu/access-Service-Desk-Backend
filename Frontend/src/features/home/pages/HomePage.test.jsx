import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import { poolPage } from "@/test/pages";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import HomePage from "./HomePage.jsx";

const COVER = [
  {
    categoryId: "c-1",
    categoryName: "Test Category",
    unitId: "u-rf",
    unitName: "Refund",
    eligibleCount: 1,
  },
];

const MINE = {
  open: 3,
  waitingToStart: 1,
  warning: 0,
  overdue: 2,
  farPast: 0,
  raisedOpen: 2,
  toConfirm: 1,
};

const unitRow = (unitId, unitName, departmentId, departmentName, counts) => ({
  unitId,
  unitName,
  departmentId,
  departmentName,
  open: 0,
  waitingToStart: 0,
  unassigned: 0,
  warning: 0,
  overdue: 0,
  farPast: 0,
  escalated: 0,
  ...counts,
});

/** Every GET /api/pool query of the last render. */
let poolAsked = [];

function renderHome(
  roles,
  cover = COVER,
  org = { departments: [] },
  summary = { generatedAt: "2026-11-19T13:05:00Z", mine: MINE, overview: null },
) {
  const queryClient = createTestQueryClient();
  poolAsked = [];
  let coverCalls = 0;
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/dashboard/summary": () => [200, summary],
    // 3 open of mine; assigned to me: 5 open, 2 Assigned + 1 Reopened, 1 Pending; the unit has 4 New.
    "GET /api/tickets": ({ params }) => {
      if (params.escalated)
        return [200, { items: [], total: 2, page: 1, pageSize: 1 }];
      const key = params.waitingToStart
        ? "waiting"
        : params.open
          ? "open"
          : params.status;
      const totals = {
        mine: { open: 3 },
        assigned: { open: 5, waiting: 3, 4: 1 },
        department: { 1: 4 },
      }[params.view];
      return [
        200,
        { items: [], total: totals[key] ?? 0, page: 1, pageSize: 1 },
      ];
    },
    // The server counts the pool per unit; the home reads units and never counts rows.
    "GET /api/pool": (config) => {
      poolAsked.push(config.params);
      return [
        200,
        poolPage(
          [
            {
              id: "p-1",
              reference: "CP-2026-000009",
              unitId: "u-rf",
              unitName: "X",
              categoryId: "c-1",
              categoryName: "Refund request",
              priority: 2,
              createdAt: "2026-11-21T08:00:00Z",
            },
            {
              id: "p-2",
              reference: "CP-2026-000010",
              unitId: "u-cm",
              unitName: "X",
              categoryId: "c-1",
              categoryName: "Refund request",
              priority: 2,
              createdAt: "2026-11-21T08:00:00Z",
            },
          ],
          config.params,
        ),
      ];
    },
    "GET /api/availability/me": () => [
      200,
      {
        today: "2026-11-21",
        inStructure: true,
        availableNow: false,
        current: {
          id: "a-1",
          userId: "u-1",
          kind: 1,
          startDate: "2026-11-20",
          endDate: "2026-11-24",
          note: null,
          recordedBy: null,
          recordedAt: "2026-11-19T09:00:00Z",
        },
        absences: [],
      },
    ],
    "GET /api/admin/categories/cover-warnings": () => {
      coverCalls += 1;
      return [200, cover];
    },
  });
  // The route guard has loaded the session before Home renders.
  queryClient.setQueryData(SESSION_KEY, makeUser({ roles }));
  renderWithProviders(<HomePage />, { queryClient });
  return { coverCalls: () => coverCalls };
}

const CASE_WORKER_ORG = {
  departments: [
    {
      id: "d-cp",
      code: "CP",
      name: "Contribution Processing",
      isHod: false,
      isAdmin: false,
      units: [
        {
          id: "u-rf",
          code: "RF",
          name: "Refund",
          isHead: false,
          isMember: true,
        },
      ],
    },
  ],
};

describe("Home", () => {
  it("shows Super Admin the categories needing cover, with a link", async () => {
    renderHome(["Requester", "SuperAdmin"]);
    expect(
      await screen.findByRole("heading", { name: "Categories needing cover" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 category has fewer than two case workers."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Categories" }),
    ).toHaveAttribute("href", "/admin/categories");
  });

  it("shows no card when nothing needs cover, and never asks for others", async () => {
    renderHome(["Requester", "SuperAdmin"], []);
    expect(await screen.findByText(/Welcome/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Categories needing cover" }),
    ).not.toBeInTheDocument();

    const requester = renderHome(["Requester"]);
    await waitFor(() => expect(screen.getAllByText(/Welcome/)).toHaveLength(2));
    expect(requester.coverCalls()).toBe(0);
  });

  it("a case worker's home is their unit: its name and department, my work, escalated by me (total), the pool and my availability", async () => {
    renderHome(["Requester", "CaseWorker"], [], CASE_WORKER_ORG);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Refund" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Contribution Processing · Welcome, Amaka"),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("mine-open")).toHaveTextContent("3");
    expect(screen.getByTestId("mine-overdue")).toHaveClass("text-danger");
    // Escalated by me is the total of the assigned, escalated, open list.
    expect(await screen.findByTestId("mine-escalated")).toHaveTextContent("2");
    const href = (testId) =>
      screen.getByTestId(testId).closest("a")?.getAttribute("href");
    const queue = "/departments/d-cp/tickets";
    expect(href("mine-open")).toBe(`${queue}?tab=assigned&status=open`);
    expect(href("mine-escalated")).toBe(`${queue}?tab=assigned&escalated=1`);
    // The pool of this unit only, with Pick up.
    expect(await screen.findByTestId("pool-waiting")).toHaveTextContent("1");
    // One row asked for: the count is the server's, per unit.
    expect(poolAsked).toEqual([{ page: 1, pageSize: 1 }]);
    expect(screen.getByRole("link", { name: "Pick up" })).toHaveAttribute(
      "href",
      `${queue}?tab=pool`,
    );
    expect(await screen.findByTestId("my-availability")).toHaveTextContent(
      "On leave until 24 Nov 2026",
    );
    expect(screen.queryByTestId("response-overdue-notice")).toBeNull();
    // No team workload, no head controls.
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Unit reports" }),
    ).not.toBeInTheDocument();
  });

  it("tells a case worker how many tickets wait for their first response", async () => {
    renderHome(["Requester", "CaseWorker"], [], CASE_WORKER_ORG, {
      generatedAt: "2026-11-19T13:05:00Z",
      mine: { ...MINE, responseOverdue: 2 },
      overview: null,
    });
    const notice = await screen.findByTestId("response-overdue-notice");
    expect(notice).toHaveTextContent(
      "2 tickets waiting for your first response. Acknowledge or reply.",
    );
    expect(notice).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets?tab=assigned&status=open",
    );
  });

  it("an HOD's home is the department overview: a row per unit opening its dashboard, a total row, no My work", async () => {
    renderHome(
      ["Requester", "HOD"],
      [],
      {
        departments: [
          {
            id: "d-tech",
            code: "TE",
            name: "Technology",
            isHod: true,
            isAdmin: false,
            units: [],
          },
        ],
      },
      {
        generatedAt: "2026-11-19T13:05:00Z",
        mine: MINE,
        overview: {
          total: {
            open: 12,
            waitingToStart: 4,
            unassigned: 2,
            warning: 3,
            overdue: 2,
            farPast: 1,
            responseOverdue: 3,
            escalated: 1,
          },
          units: [
            unitRow("u-it", "IT Support", "d-tech", "Technology", {
              open: 7,
              overdue: 1,
              unassigned: 2,
              responseOverdue: 3,
            }),
            unitRow("u-rf", "Refund", "d-tech", "Technology", { open: 5 }),
          ],
        },
      },
    );
    expect(
      await screen.findByRole("heading", { name: "Department overview" }),
    ).toBeInTheDocument();
    await screen.findByTestId("unit-IT Support");
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual([
      "Unit",
      "Open",
      "Unassigned",
      "Waiting to start",
      "Overdue",
      "Far past",
      "Response overdue",
      "Escalated",
      "Dashboard",
    ]);
    // One department: no Department column.
    expect(
      screen.queryByRole("columnheader", { name: "Department" }),
    ).not.toBeInTheDocument();
    const it = screen.getByTestId("unit-IT Support");
    expect(
      within(it).getByRole("link", { name: "IT Support" }),
    ).toHaveAttribute("href", "/dashboard/unit/u-it");
    const cells = within(it).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("7");
    expect(cells[3]).toHaveTextContent("1");
    expect(cells[3]).toHaveClass("text-danger");
    expect(cells[4]).toHaveClass("text-muted");
    const total = screen.getByTestId("overview-total");
    expect(within(total).getByText("Total")).toBeInTheDocument();
    expect(within(total).getAllByRole("cell")[0]).toHaveTextContent("12");
    // Response overdue: the unit's figure in red, and the total.
    expect(cells[5]).toHaveTextContent("3");
    expect(cells[5]).toHaveClass("text-danger");
    expect(within(total).getAllByRole("cell")[5]).toHaveTextContent("3");
    // No My work and no "Tickets I raised" block; requesting stays on the button.
    expect(
      screen.queryByRole("heading", { name: "My work" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Tickets I raised")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Raise a ticket" }),
    ).toHaveAttribute("href", "/tickets/new");
  });

  it("names the department when the units come from more than one", async () => {
    renderHome(
      ["Requester", "SuperAdmin"],
      [],
      { departments: [] },
      {
        generatedAt: "2026-11-19T13:05:00Z",
        mine: MINE,
        overview: {
          total: {
            open: 2,
            waitingToStart: 0,
            unassigned: 0,
            warning: 0,
            overdue: 0,
            farPast: 0,
            escalated: 0,
          },
          units: [
            unitRow("u-it", "IT Support", "d-tech", "Technology", { open: 1 }),
            unitRow("u-rf", "Refund", "d-cp", "Contribution Processing", {
              open: 1,
            }),
          ],
        },
      },
    );
    expect(
      await screen.findByRole("columnheader", { name: "Department" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("unit-Refund")).toHaveTextContent(
      "Contribution Processing",
    );
  });
});
