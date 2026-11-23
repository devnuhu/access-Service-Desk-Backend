import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import UnitDashboard from "../components/UnitDashboard.jsx";
import HomePage from "./HomePage.jsx";

const dashboard = (overrides = {}) => ({
  generatedAt: "2026-11-21T09:05:00Z",
  unitId: "u-cm",
  unitName: "Contribution Matching",
  departmentId: "d-cp",
  departmentName: "Contribution Processing",
  counts: {
    open: 9,
    waitingToStart: 2,
    unassigned: 3,
    warning: 1,
    overdue: 2,
    farPast: 1,
    escalated: 1,
    responseOverdue: 2,
  },
  pool: [
    {
      categoryId: "c-1",
      categoryName: "Balance does not agree",
      waiting: 3,
      oldestWaitingAt: "2026-11-21T06:00:00Z",
    },
  ],
  team: [
    {
      userId: "p-1",
      userName: "test.hou",
      fullName: "Hope Head",
      isHead: true,
      openTickets: 1,
      waitingToStart: 0,
      warning: 0,
      overdue: 0,
      farPast: 0,
      onLeave: false,
      leaveUntil: null,
    },
    {
      userId: "p-2",
      userName: "test.cw1",
      fullName: "Chidi One",
      isHead: false,
      openTickets: 4,
      waitingToStart: 1,
      warning: 0,
      overdue: 1,
      farPast: 1,
      responseOverdue: 1,
      responseMissed: 3,
      responseMetPercent: 72.4,
      onLeave: true,
      leaveUntil: "2026-11-24",
    },
  ],
  categories: [
    {
      categoryId: "c-1",
      categoryName: "Balance does not agree",
      isActive: true,
      eligibleCount: 1,
      openTickets: 5,
      needsCover: true,
    },
    {
      categoryId: "c-2",
      categoryName: "Wrong employer code",
      isActive: true,
      eligibleCount: 3,
      openTickets: 4,
      needsCover: false,
    },
  ],
  escalated: [
    {
      ticketId: "t-7",
      reference: "CP-2026-000007",
      categoryName: "Wrong employer code",
      assigneeName: "Chidi One",
      level: "escalated",
      since: "2026-11-21T08:00:00Z",
      note: "Needs the employer's letter.",
    },
  ],
  attention: [
    {
      ticketId: "t-3",
      reference: "CP-2026-000003",
      categoryName: "Balance does not agree",
      assigneeName: null,
      level: "farPast",
      since: "2026-11-10T08:00:00Z",
    },
    {
      ticketId: "t-4",
      reference: "CP-2026-000004",
      categoryName: "Wrong employer code",
      assigneeName: "Chidi One",
      level: "overdue",
      since: "2026-11-18T08:00:00Z",
    },
  ],
  ...overrides,
});

const CP = { id: "d-cp", code: "CP", name: "Contribution Processing" };

function headOrg(units) {
  return {
    departments: [{ ...CP, isHod: false, isAdmin: false, units }],
  };
}

function setup(routes, roles = ["Requester", "CaseWorker", "HeadOfUnit"]) {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    "GET /api/dashboard/unit/:unitId": (config) => {
      asked.push(config.pathParams.unitId);
      return [200, dashboard({ unitId: config.pathParams.unitId })];
    },
    ...routes,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ roles }));
  return { queryClient, asked };
}

describe("Unit dashboard (Head of Unit)", () => {
  it("is the head's home, with every section in order", async () => {
    const { queryClient } = setup({
      "GET /api/org/me": () => [
        200,
        headOrg([
          {
            id: "u-cm",
            code: "CM",
            name: "Contribution Matching",
            isHead: true,
            isMember: true,
          },
        ]),
      ],
    });
    renderWithProviders(<HomePage />, { queryClient });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Contribution Matching",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Needs attention",
      "Unit pool",
      "Escalated to me",
      "Team",
      "Categories",
      "Past deadline",
      "Performance",
    ]);
    expect(screen.getByText("Dashboard · Updated 10:05")).toBeInTheDocument();
    // The line above the title: the unit, then its department.
    expect(screen.getByTestId("unit-eyebrow")).toHaveTextContent(
      "Contribution Matching · Contribution Processing",
    );

    // Needs attention: each count opens the unit's filtered list.
    const queue = "/departments/d-cp/tickets?tab=department&unit=u-cm";
    const href = (key) =>
      screen.getByTestId(`attention-${key}`).closest("a").getAttribute("href");
    expect(screen.getByTestId("attention-unassigned")).toHaveTextContent("3");
    expect(href("unassigned")).toBe(`${queue}&status=1`);
    expect(href("escalated")).toBe(`${queue}&escalated=1`);
    expect(href("overdue")).toBe(`${queue}&overdue=1`);
    expect(screen.getByTestId("attention-farPast")).toHaveClass("text-danger");
    // Response overdue: a figure (no link), red above 0.
    const response = screen.getByTestId("attention-responseOverdue");
    expect(response).toHaveTextContent("2");
    expect(response).toHaveClass("text-danger");
    expect(response.closest("a")).toBeNull();

    // Pool: Pick opens the Unit pool tab.
    expect(screen.getByRole("link", { name: "Pick" })).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets?tab=pool&unit=u-cm",
    );

    // Escalated to me: who passed it up, why, a link to the ticket.
    const up = screen.getByTestId("escalated-CP-2026-000007");
    expect(
      within(up).getByRole("link", { name: "CP-2026-000007" }),
    ).toHaveAttribute("href", "/tickets/CP-2026-000007");
    expect(within(up).getByText("Chidi One")).toBeInTheDocument();
    expect(
      within(up).getByText("Needs the employer's letter."),
    ).toBeInTheDocument();

    // Team: head first; leave shows the date; overdue counts far past too.
    const rows = within(screen.getByTestId("unit-team")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Hope Head");
    expect(within(rows[1]).getByText("Head")).toBeInTheDocument();
    const chidi = screen.getByTestId("member-test.cw1");
    expect(
      within(chidi).getByText("On leave until 24 Nov 2026"),
    ).toBeInTheDocument();
    expect(within(chidi).getAllByRole("cell")[2]).toHaveTextContent("2");
    // First response: now, missed in 30 days, met share (red under 75%).
    expect(within(chidi).getByTestId("response-overdue")).toHaveTextContent(
      "1",
    );
    expect(within(chidi).getByTestId("response-missed")).toHaveTextContent("3");
    const met = within(chidi).getByTestId("response-met");
    expect(met).toHaveTextContent("72%");
    expect(met).toHaveClass("text-danger");
    // The head's own row: dashes.
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .slice(3)
        .map((cell) => cell.textContent),
    ).toEqual(["-", "-", "-"]);
    // The columns explain how it is counted.
    const header = screen.getByRole("columnheader", {
      name: "Responded in time",
    });
    expect(header).toHaveAccessibleDescription(
      /Counted from when the ticket was assigned to them/,
    );

    // Categories: a red Needs cover chip only where needsCover.
    const thin = screen.getByTestId("category-Balance does not agree");
    expect(within(thin).getByText("Needs cover")).toHaveClass("text-danger");
    expect(
      within(screen.getByTestId("category-Wrong employer code")).queryByText(
        "Needs cover",
      ),
    ).not.toBeInTheDocument();

    // Past deadline: far past first, unassigned said so.
    const late = screen.getByTestId("late-CP-2026-000003");
    expect(within(late).getByText("Far past")).toBeInTheDocument();
    expect(within(late).getByText("Unassigned")).toBeInTheDocument();

    // Links to Reports for the unit and to team availability.
    expect(screen.getByRole("link", { name: "Unit reports" })).toHaveAttribute(
      "href",
      "/reports?unit=u-cm",
    );
    expect(screen.getByRole("link", { name: "Availability" })).toHaveAttribute(
      "href",
      "/availability/units/u-cm",
    );
    // A head's home has no My work block.
    expect(
      screen.queryByRole("heading", { name: "My work" }),
    ).not.toBeInTheDocument();
  });

  it("a head of two units switches between them", async () => {
    const user = userEvent.setup();
    const { queryClient, asked } = setup({
      "GET /api/org/me": () => [
        200,
        headOrg([
          {
            id: "u-cm",
            code: "CM",
            name: "Matching",
            isHead: true,
            isMember: true,
          },
          {
            id: "u-rf",
            code: "RF",
            name: "Refund",
            isHead: true,
            isMember: true,
          },
        ]),
      ],
    });
    renderWithProviders(<HomePage />, { queryClient });
    const group = await screen.findByRole("group", { name: "Your units" });
    expect(
      within(group).getByRole("button", { name: "Matching" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Refund" }));
    expect(
      await screen.findByRole("button", { name: "Refund", pressed: true }),
    ).toBeInTheDocument();
    expect(asked).toEqual(["u-cm", "u-rf"]);
  });

  it("a 403 shows a plain not-allowed page", async () => {
    const { queryClient } = setup({
      "GET /api/dashboard/unit/:unitId": () => [
        403,
        { message: "Only the head of this unit can see its dashboard." },
      ],
    });
    renderWithProviders(<UnitDashboard unitId="u-cm" />, { queryClient });
    expect(
      await screen.findByRole("heading", {
        name: "You are not allowed to see this",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Needs attention" }),
    ).not.toBeInTheDocument();
  });

  it("an unknown unit (404) says so", async () => {
    const { queryClient } = setup({
      "GET /api/dashboard/unit/:unitId": () => [
        404,
        { message: "Unit not found." },
      ],
    });
    renderWithProviders(<UnitDashboard unitId="u-x" />, { queryClient });
    expect(
      await screen.findByRole("heading", { name: "Unit not found" }),
    ).toBeInTheDocument();
  });
});
