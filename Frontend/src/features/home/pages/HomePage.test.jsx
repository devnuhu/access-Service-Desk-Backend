import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
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

function renderHome(roles, cover = COVER, org = { departments: [] }) {
  const queryClient = createTestQueryClient();
  let coverCalls = 0;
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    // 3 open of mine; assigned to me: 5 open, 2 Assigned + 1 Reopened, 1 Pending; the unit has 4 New.
    "GET /api/tickets": ({ params }) => {
      const key = params.open ? "open" : params.status;
      const totals = {
        mine: { open: 3 },
        assigned: { open: 5, 2: 2, 6: 1, 4: 1 },
        department: { 1: 4 },
      }[params.view];
      return [
        200,
        { items: [], total: totals[key] ?? 0, page: 1, pageSize: 1 },
      ];
    },
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
    expect(await screen.findAllByText(/Welcome/)).toHaveLength(2);
    expect(requester.coverCalls()).toBe(0);
  });

  it("shows Raise a ticket, my open requests and, for unit members, Assigned to me and New in my unit", async () => {
    renderHome(["Requester", "CaseWorker"], [], {
      departments: [
        {
          id: "d-cp",
          code: "CP",
          name: "Contribution Processing",
          isHod: false,
          units: [
            {
              id: "u-rf",
              code: "RF",
              name: "Refund",
              isHead: false,
              isDeputy: false,
              isMember: true,
            },
          ],
        },
      ],
    });
    expect(
      await screen.findByRole("link", { name: "Raise a ticket" }),
    ).toHaveAttribute("href", "/tickets/new");
    expect(await screen.findByTestId("count-my-open")).toHaveTextContent("3");
    expect(await screen.findByTestId("count-new-u-rf")).toHaveTextContent("4");
    expect(await screen.findByTestId("count-assigned")).toHaveTextContent("5");
    expect(await screen.findByTestId("count-waiting")).toHaveTextContent("3");
    expect(await screen.findByTestId("count-pending")).toHaveTextContent("1");
    expect(
      screen.getByRole("link", { name: "Work queue (Assigned to me)" }),
    ).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets?tab=assigned&status=open",
    );
    expect(
      screen.getByRole("link", { name: "Work queue (Waiting to start)" }),
    ).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets?tab=assigned&status=start",
    );
    expect(
      screen.getByRole("link", { name: "Work queue (Pending)" }),
    ).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets?tab=assigned&status=4",
    );
    expect(
      screen.getByRole("link", { name: "Work queue (New in Refund)" }),
    ).toHaveAttribute("href", "/departments/d-cp/tickets");
  });
});
