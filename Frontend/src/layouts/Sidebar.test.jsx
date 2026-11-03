import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
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
  isDeputy: false,
  isMember: false,
  ...flags,
});

/** test.hou: head (and so member) of Contribution Matching. */
const HOU_ORG = {
  departments: [
    {
      ...CP,
      isHod: false,
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

const section = (title) =>
  screen.getByRole("heading", { name: title }).closest("div");

describe("Sidebar from org/me", () => {
  it("test.hou sees Contribution Processing with Contribution Matching availability", async () => {
    renderSidebar(["Requester", "CaseWorker", "HeadOfUnit"], HOU_ORG);
    expect(
      await screen.findByRole("heading", { name: "Contribution Processing" }),
    ).toBeInTheDocument();
    const cp = section("Contribution Processing");
    expect(
      within(cp).getByRole("link", { name: "Work queue" }),
    ).toHaveAttribute("href", "/departments/d-cp/tickets");
    expect(
      within(cp).getByRole("link", {
        name: "Contribution Matching availability",
      }),
    ).toHaveAttribute("href", "/availability/units/u-cm");
    expect(
      within(cp).queryByText("Department availability"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "My availability" }),
    ).toHaveAttribute("href", "/availability");
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("an HOD gets Department availability and the Work queue (department staff)", async () => {
    renderSidebar(["Requester", "HOD"], {
      departments: [{ ...CP, isHod: true, units: [] }],
    });
    const link = await screen.findByRole("link", {
      name: "Department availability",
    });
    expect(link).toHaveAttribute("href", "/availability/departments/d-cp");
    expect(screen.getByRole("link", { name: "Work queue" })).toHaveAttribute(
      "href",
      "/departments/d-cp/tickets",
    );
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

  it("My requests is a link for everyone; coming-soon items are disabled, not links", async () => {
    renderSidebar(["Requester", "HeadOfUnit"], HOU_ORG);
    expect(
      await screen.findByRole("link", { name: "My requests" }),
    ).toHaveAttribute("href", "/tickets");
    expect(
      screen.queryByRole("link", { name: /Reports/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Reports").closest("[aria-disabled]"),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
