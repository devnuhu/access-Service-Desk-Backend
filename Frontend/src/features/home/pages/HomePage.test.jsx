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

function renderHome(roles, cover = COVER) {
  const queryClient = createTestQueryClient();
  let coverCalls = 0;
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, { departments: [] }],
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
});
