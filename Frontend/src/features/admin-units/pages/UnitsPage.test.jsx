import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import UnitPage from "./UnitPage.jsx";
import UnitsPage from "./UnitsPage.jsx";

const person = (id, userName, fullName) => ({
  userId: id,
  userName,
  fullName,
  email: `${userName}@example.test`,
});

const DEPARTMENTS = [
  {
    id: "d-cp",
    code: "CP",
    name: "Contribution Processing",
    isActive: true,
    hod: person("p-hod", "test.hod", "Test HOD"),
    units: [
      {
        id: "u-cm",
        departmentId: "d-cp",
        code: "CM",
        name: "Contribution Matching",
        isActive: true,
        head: person("p-hou", "test.hou", "Test HOU"),
        deputy: null,
        memberCount: 3,
      },
      {
        id: "u-rf",
        departmentId: "d-cp",
        code: "RF",
        name: "Refund",
        isActive: true,
        head: person("p-hou2", "test.hou2", "Test HOU2"),
        deputy: null,
        memberCount: 3,
      },
    ],
  },
  {
    id: "d-old",
    code: "OLD",
    name: "Old Department",
    isActive: false,
    hod: null,
    units: [],
  },
];

const MEMBERS = [
  {
    userId: "p-hou",
    userName: "test.hou",
    fullName: "Test HOU",
    email: null,
    staffNo: null,
    staffCategory: 2,
    isHead: true,
    isDeputy: false,
    accountActive: true,
    joinedAt: "2026-11-02T10:00:00Z",
    lastAssignedAt: null,
  },
  {
    userId: "p-cw1",
    userName: "test.caseworker1",
    fullName: "Test Caseworker1",
    email: null,
    staffNo: "AP-001",
    staffCategory: 1,
    isHead: false,
    isDeputy: false,
    accountActive: true,
    joinedAt: "2026-11-02T10:00:00Z",
    lastAssignedAt: null,
  },
];

function renderAt(route, extraRoutes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/admin/departments": () => [200, DEPARTMENTS],
    "GET /api/admin/units/:unitId/members": () => [200, MEMBERS],
    "GET /api/org/me": () => [200, { departments: [] }],
    "GET /api/org/departments": () => [200, []],
    ...extraRoutes,
  });
  renderWithProviders(
    <Routes>
      <Route path="/admin/units" element={<UnitsPage />} />
      <Route path="/admin/units/:unitId" element={<UnitPage />} />
    </Routes>,
    { route, queryClient },
  );
  return api;
}

describe("Units", () => {
  it("renders departments, the HOD, units, heads and member counts", async () => {
    renderAt("/admin/units");
    const cp = (
      await screen.findByRole("heading", { name: /Contribution Processing/ })
    ).closest("section");
    expect(within(cp).getByText("Test HOD")).toBeInTheDocument();
    const cm = within(cp).getByText("Contribution Matching").closest("tr");
    expect(within(cm).getByText("Test HOU")).toBeInTheDocument();
    expect(within(cm).getByText("3")).toBeInTheDocument();
    expect(
      within(cm).getByRole("link", { name: "Manage Contribution Matching" }),
    ).toHaveAttribute("href", "/admin/units/u-cm");
    const refund = within(cp).getByText("Refund").closest("tr");
    expect(within(refund).getByText("Test HOU2")).toBeInTheDocument();

    // Switched-off departments come last, marked Off, with "No HOD".
    const old = screen
      .getByRole("heading", { name: /Old Department/ })
      .closest("section");
    expect(within(old).getByText("Off")).toBeInTheDocument();
    expect(within(old).getByText("No HOD")).toBeInTheDocument();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings[0]).toMatch(/Contribution Processing/);
  });

  it("upper-cases the department code and shows the prefix hint", async () => {
    renderAt("/admin/units");
    await userEvent.click(
      await screen.findByRole("button", { name: "Add department" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add department",
    });
    const code = within(dialog).getByLabelText("Code");
    await userEvent.type(code, "hr-1");
    expect(code).toHaveValue("HR-1");
    expect(
      within(dialog).getByText(
        "Used as the ticket reference prefix, for example CP. Cannot be changed later.",
      ),
    ).toBeInTheDocument();
  });

  it("unit page: members with Head chip, and a 409 from Add member appears as a toast", async () => {
    let sent;
    renderAt("/admin/units/u-cm", {
      "GET /api/admin/users": () => [
        200,
        {
          items: [
            {
              id: "p-req",
              userName: "test.requester",
              fullName: "Test Requester",
              email: null,
              department: "Operations",
              jobTitle: null,
              roles: ["Requester"],
              isActive: true,
              hasSignedIn: true,
              lastLoginAt: null,
              createdAt: "2026-11-01T09:00:00Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      ],
      "POST /api/admin/units/:unitId/members": ({ body }) => {
        sent = body;
        return [
          409,
          {
            message: "Test Requester is already in a unit of this department.",
            errors: {},
          },
        ];
      },
    });

    expect(
      await screen.findByRole("heading", { name: /Contribution Matching/ }),
    ).toBeInTheDocument();
    const headRow = (await screen.findByText("test.hou")).closest("tr");
    expect(within(headRow).getByText("Head")).toBeInTheDocument();
    expect(
      within(headRow).getByRole("button", { name: "Remove Test HOU" }),
    ).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add a member to Contribution Matching",
    });
    await userEvent.type(within(dialog).getByLabelText("Find a person"), "req");
    await userEvent.click(
      await within(dialog).findByRole("button", { name: /Test Requester/ }),
    );
    await userEvent.type(within(dialog).getByLabelText(/Staff number/), "AP-9");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add member" }),
    );
    expect(
      await screen.findByText(
        "Test Requester is already in a unit of this department.",
      ),
    ).toBeInTheDocument();
    expect(sent).toEqual({ userId: "p-req", staffNo: "AP-9" });
  });

  it("unit page: Skills matrix button and how many categories each member handles", async () => {
    let skills = [
      { userId: "p-hou", categoryIds: ["c-1", "c-2", "c-3"] },
      { userId: "p-cw1", categoryIds: ["c-1", "c-2"] },
    ];
    let removed;
    renderAt("/admin/units/u-cm", {
      "GET /api/admin/units/:unitId/skills": () => [
        200,
        {
          unitId: "u-cm",
          unitName: "Contribution Matching",
          categories: [],
          members: skills.map((m) => ({
            userName: m.userId,
            fullName: null,
            staffCategory: 1,
            accountActive: true,
            ...m,
          })),
          warnings: [],
        },
      ],
      "DELETE /api/admin/units/:unitId/members/:userId": ({ pathParams }) => {
        removed = pathParams.userId;
        skills = skills.filter((m) => m.userId !== removed);
        return [200, { message: "Test Caseworker1 removed." }];
      },
    });
    expect(
      await screen.findByRole("link", { name: "Skills matrix" }),
    ).toHaveAttribute("href", "/admin/units/u-cm/skills");
    expect(await screen.findByTestId("categories-p-cw1")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("categories-p-hou")).toHaveTextContent("3");

    // Removing a member refreshes the matrix too (leaving the unit ends the mappings).
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Test Caseworker1" }),
    );
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Remove this member?" }),
      ).getByRole("button", { name: "Remove" }),
    );
    expect(removed).toBe("p-cw1");
    await waitFor(() =>
      expect(screen.getByTestId("categories-p-cw1")).toHaveTextContent("0"),
    );
  });
});
