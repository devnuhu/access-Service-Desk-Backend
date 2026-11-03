import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
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
  isDeputy: false,
  isMember: false,
  ...flags,
});

const item = (reference, status, createdAt) => ({
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
  createdAt,
  updatedAt: null,
});

function renderQueue(roles, org, tickets = {}) {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/org/departments": () => [200, []],
    "GET /api/tickets": (config) => {
      asked.push(config.params);
      const items = tickets[config.params.status] ?? [];
      return [
        200,
        {
          items,
          total: items.length,
          page: 1,
          pageSize: config.params.pageSize,
        },
      ];
    },
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ roles }));
  renderWithProviders(
    <Routes>
      <Route
        path="/departments/:departmentId/tickets"
        element={<WorkQueuePage />}
      />
      <Route path="/no-access" element={<p>No access page</p>} />
    </Routes>,
    { route: "/departments/d-cp/tickets", queryClient },
  );
  return asked;
}

describe("Work queue", () => {
  it("a requester without department access gets the no-access page", async () => {
    const asked = renderQueue(["Requester"], { departments: [] });
    expect(await screen.findByText("No access page")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it("staff see their unit's open tickets (one call per open status, newest first), Unassigned", async () => {
    const asked = renderQueue(
      ["Requester", "CaseWorker", "HeadOfUnit"],
      {
        departments: [
          {
            ...CP,
            isHod: false,
            units: [
              unit("u-cm", "Contribution Matching", {
                isHead: true,
                isMember: true,
              }),
            ],
          },
        ],
      },
      {
        1: [item("CP-2026-000002", 1, "2026-11-03T10:00:00Z")],
        4: [item("CP-2026-000001", 4, "2026-11-02T10:00:00Z")],
      },
    );
    expect(
      await screen.findByRole("heading", {
        name: "Contribution Processing: work queue",
      }),
    ).toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^ticket-row-/);
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "ticket-row-CP-2026-000002",
      "ticket-row-CP-2026-000001",
    ]);
    expect(within(rows[0]).getByText("Unassigned")).toBeInTheDocument();
    expect(within(rows[0]).getByText("New")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toHaveDisplayValue(
      "Contribution Matching",
    );
    expect(asked.map((query) => query.status).sort()).toEqual([1, 2, 3, 4, 6]);
    expect(
      asked.every(
        (query) =>
          query.view === "department" &&
          query.departmentId === "d-cp" &&
          query.unitId === "u-cm",
      ),
    ).toBe(true);
  });
});
