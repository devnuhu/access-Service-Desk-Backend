import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearCsrfToken, setCsrfToken } from "@/shared/lib/http";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import PeopleRolesPage from "./PeopleRolesPage.jsx";

const ROLES = [
  { id: "r-req", name: "Requester", description: null },
  { id: "r-cw", name: "CaseWorker", description: null },
  { id: "r-hou", name: "HeadOfUnit", description: null },
  { id: "r-hod", name: "HOD", description: null },
  { id: "r-sa", name: "SuperAdmin", description: null },
];

const PERSON = {
  id: "p-1",
  userName: "tunde.bello",
  fullName: "Tunde Bello",
  email: "tunde.bello@example.test",
  department: "Operations",
  jobTitle: "Officer",
  roles: ["CaseWorker", "Requester"],
  isActive: true,
  hasSignedIn: false,
  lastLoginAt: null,
  createdAt: "2026-11-01T09:00:00Z",
};

function renderPage(extraRoutes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/admin/users": () => [
      200,
      { items: [PERSON], total: 1, page: 1, pageSize: 20 },
    ],
    "GET /api/admin/users/:userId": () => [200, PERSON],
    "GET /api/admin/roles": () => [200, ROLES],
    ...extraRoutes,
  });
  renderWithProviders(<PeopleRolesPage />, { queryClient });
  return api;
}

async function openPanel() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Tunde Bello" }),
  );
  return screen.findByRole("dialog", { name: "Tunde Bello" });
}

afterEach(() => clearCsrfToken());

describe("PeopleRolesPage", () => {
  it("lists people with role chips and status", async () => {
    renderPage();
    const row = (await screen.findByText("tunde.bello")).closest("tr");
    expect(within(row).getByText("Case Worker")).toBeInTheDocument();
    expect(within(row).getByText("Requester")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByText("Not signed in yet")).toBeInTheDocument();
  });

  it("offers no remove button on Requester, and one on other roles", async () => {
    renderPage();
    const panel = await openPanel();
    const roles = await within(panel).findByTestId("panel-roles");
    expect(
      within(roles).getByRole("button", { name: "Remove Case Worker" }),
    ).toBeInTheDocument();
    expect(
      within(roles).queryByRole("button", { name: /Remove Requester/ }),
    ).not.toBeInTheDocument();
    expect(
      within(roles).getByTitle("Every staff member is a Requester"),
    ).toBeInTheDocument();
  });

  it("shows a 409 message as a toast, sending the CSRF header", async () => {
    setCsrfToken("csrf-1");
    let sentHeader;
    renderPage({
      "POST /api/admin/users/:userId/roles": (config) => {
        sentHeader = config.headers.get("X-CSRF-Token");
        expect(config.body).toEqual({ roleId: "r-hou" });
        return [409, { message: "Tunde Bello already has this role." }];
      },
    });
    const panel = await openPanel();
    const select = await within(panel).findByLabelText("Give a role");
    await waitFor(() =>
      expect(
        within(select).getByRole("option", { name: "Head of Unit" }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(select, "r-hou");
    await userEvent.click(within(panel).getByRole("button", { name: "Give" }));
    expect(
      await screen.findByText("Tunde Bello already has this role."),
    ).toBeInTheDocument();
    expect(sentHeader).toBe("csrf-1");
  });

  it("asks before blocking, then shows the API message", async () => {
    let sent;
    renderPage({
      "PATCH /api/admin/users/:userId/status": ({ body }) => {
        sent = body;
        return [400, { message: "You cannot block yourself." }];
      },
    });
    const panel = await openPanel();
    await userEvent.click(
      await within(panel).findByRole("button", { name: "Block access" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Block access?",
    });
    expect(
      within(confirm).getByText("Blocking signs them out everywhere."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Block access" }),
    );
    expect(
      await screen.findByText("You cannot block yourself."),
    ).toBeInTheDocument();
    expect(sent).toEqual({ isActive: false });
  });

  it("shows the directory's 503 message in the add dialog", async () => {
    renderPage({
      "GET /api/directory/users/search": () => [
        503,
        { message: "The staff directory could not be searched right now." },
      ],
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Add from directory" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add from directory",
    });
    await userEvent.type(
      within(dialog).getByLabelText("Search the directory"),
      "ada",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Search/ }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The staff directory could not be searched right now.",
    );
  });
});
