import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import Sidebar from "./Sidebar.jsx";

const CP = { id: "d-cp", code: "CP", name: "Contribution Processing" };
const CM = { id: "u-cm", code: "CM", name: "Contribution Matching" };
const RF = { id: "u-rf", code: "RF", name: "Refund" };

const unit = (base, flags = {}) => ({
  ...base,
  isHead: false,
  isMember: false,
  ...flags,
});

/** test.hou: head (and so member) of Contribution Matching. */
const HOU_ORG = {
  departments: [
    {
      ...CP,
      isHod: false,
      isAdmin: false,
      units: [unit(CM, { isHead: true, isMember: true })],
    },
  ],
};

function renderSidebar(roles, org, departments = []) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/org/departments": () => [200, departments],
  });
  renderWithProviders(<Sidebar user={makeUser({ roles })} />, { queryClient });
  return api;
}

/** The menu's link names, in order. */
const linkNames = () =>
  screen.getAllByRole("link").map((link) => link.textContent);

const section = (title) =>
  screen.getByRole("heading", { name: title }).closest("div");

describe("Sidebar from org/me", () => {
  it("a head of one unit gets no group: all five head items are in the main list", async () => {
    renderSidebar(["Requester", "CaseWorker", "HeadOfUnit"], HOU_ORG);
    expect(
      await screen.findByRole("link", { name: "My unit" }),
    ).toHaveAttribute("href", "/units/u-cm");
    expect(linkNames()).toEqual([
      "Dashboard",
      "Work queue",
      "Team availability",
      "My unit",
      "Reports",
    ]);
    expect(screen.getByRole("link", { name: "Work queue" })).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets",
    );
    expect(
      screen.getByRole("link", { name: "Team availability" }),
    ).toHaveAttribute("href", "/availability/units/u-cm");
    // No group header and nothing to fold.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { expanded: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Contribution Processing"),
    ).not.toBeInTheDocument();
  });

  it("an HOD keeps the department group: Work queue and Department availability, no My requests", async () => {
    renderSidebar(["Requester", "HOD"], {
      departments: [{ ...CP, isHod: true, isAdmin: false, units: [] }],
    });
    expect(
      await screen.findByRole("heading", { name: "Contribution Processing" }),
    ).toBeInTheDocument();
    const group = section("Contribution Processing");
    expect(
      within(group).getByRole("link", { name: "Department availability" }),
    ).toHaveAttribute("href", "/availability/departments/d-cp");
    expect(linkNames()).toEqual([
      "Home",
      "Work queue",
      "Department availability",
      "Reports",
    ]);
  });

  it("a case worker of one unit gets no group: Work queue is a top-level link to the unit's queue", async () => {
    const user = userEvent.setup();
    renderSidebar(["Requester", "CaseWorker"], {
      departments: [
        {
          ...CP,
          isHod: false,
          isAdmin: false,
          units: [unit(RF, { isMember: true })],
        },
      ],
    });
    const queue = await screen.findByRole("link", { name: "Work queue" });
    expect(linkNames()).toEqual([
      "Home",
      "My requests",
      "My availability",
      "Work queue",
    ]);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Refund")).not.toBeInTheDocument();
    await user.click(queue);
    expect(queue).toHaveAttribute("aria-current", "page");
    expect(queue).toHaveAttribute("href", "/departments/d-cp/tickets");
  });

  it("a head of two units keeps one group per unit", async () => {
    renderSidebar(["Requester", "CaseWorker", "HeadOfUnit"], {
      departments: [
        {
          ...CP,
          isHod: false,
          isAdmin: false,
          units: [unit(CM, { isHead: true, isMember: true })],
        },
        {
          id: "d-bp",
          code: "BP",
          name: "Benefit Processing",
          isHod: false,
          isAdmin: false,
          units: [
            unit(
              { id: "u-pw", code: "PW", name: "Programmed Withdrawal" },
              { isHead: true, isMember: true },
            ),
          ],
        },
      ],
    });
    expect(
      await screen.findByRole("heading", { name: "Contribution Matching" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Programmed Withdrawal" }),
    ).toBeInTheDocument();
    expect(
      within(section("Programmed Withdrawal")).getByText("Benefit Processing"),
    ).toBeInTheDocument();
    expect(
      within(section("Contribution Matching")).getByRole("link", {
        name: "My unit",
      }),
    ).toHaveAttribute("href", "/units/u-cm");
  });

  it("someone in units of two departments gets one group per unit", async () => {
    renderSidebar(["Requester", "CaseWorker"], {
      departments: [
        {
          ...CP,
          isHod: false,
          isAdmin: false,
          units: [unit(RF, { isMember: true })],
        },
        {
          id: "d-bp",
          code: "BP",
          name: "Benefit Processing",
          isHod: false,
          isAdmin: false,
          units: [
            unit(
              { id: "u-pw", code: "PW", name: "Programmed Withdrawal" },
              {
                isMember: true,
              },
            ),
          ],
        },
      ],
    });
    expect(
      await screen.findByRole("heading", { name: "Programmed Withdrawal" }),
    ).toBeInTheDocument();
    expect(
      within(section("Programmed Withdrawal")).getByRole("link", {
        name: "Work queue",
      }),
    ).toHaveAttribute("href", "/departments/d-bp/tickets");
    expect(
      within(section("Refund")).getByRole("link", { name: "Work queue" }),
    ).toHaveAttribute("href", "/departments/d-cp/tickets");
  });

  it("a requester with no departments has no module section and no My availability", async () => {
    const api = renderSidebar(["Requester"], { departments: [] });
    expect(
      await screen.findByRole("link", { name: "Home" }),
    ).toBeInTheDocument();
    await screen.findByText("My requests");
    // Wait for org/me to have answered before asserting what is absent.
    await expect.poll(() => api.adapter.mock.calls.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: "My availability" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Contribution Processing"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });

  it("a Super Admin with no departments gets sections from /api/org/departments", async () => {
    renderSidebar(["Requester", "SuperAdmin"], { departments: [] }, [
      { ...CP, units: [CM, RF] },
    ]);
    expect(
      await screen.findByRole("heading", { name: "Contribution Processing" }),
    ).toBeInTheDocument();
    expect(
      within(section("Contribution Processing")).getByRole("link", {
        name: "Department availability",
      }),
    ).toHaveAttribute("href", "/availability/departments/d-cp");
    expect(
      within(section("Contribution Processing")).getByRole("link", {
        name: "Work queue",
      }),
    ).toHaveAttribute("href", "/departments/d-cp/tickets");
    const admin = section("Administration");
    expect(
      within(admin).getByRole("link", { name: "People and roles" }),
    ).toHaveAttribute("href", "/admin/people");
    expect(within(admin).getByRole("link", { name: "Units" })).toHaveAttribute(
      "href",
      "/admin/units",
    );
    expect(
      within(admin).getByRole("link", { name: "Locations" }),
    ).toHaveAttribute("href", "/admin/locations");
    expect(within(admin).getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "/admin/email",
    );
    expect(
      screen.queryByRole("link", { name: "My availability" }),
    ).not.toBeInTheDocument();
  });

  it("a Department Admin gets Reports", async () => {
    renderSidebar(["Requester", "DepartmentAdmin"], { departments: [] });
    expect(
      await screen.findByRole("link", { name: "Reports" }),
    ).toHaveAttribute("href", "/reports");
  });

  it("a Case Worker has no Reports", async () => {
    renderSidebar(["Requester", "CaseWorker"], {
      departments: [
        {
          ...CP,
          isHod: false,
          isAdmin: false,
          units: [unit(RF, { isMember: true })],
        },
      ],
    });
    expect(
      await screen.findByRole("link", { name: "My requests" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });
});
