import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const CW1 = { userId: "u-cw1", userName: "test.caseworker1", fullName: null };

const item = (
  reference,
  status,
  createdAt,
  assignee = null,
  assignedAt = null,
) => ({
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
  assignee,
  assignedAt,
  createdAt,
  updatedAt: null,
});

function renderQueue(roles, org, tickets = {}, search = "") {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/org/departments": () => [200, []],
    "GET /api/tickets": (config) => {
      asked.push(config.params);
      // tickets: { open | [status]: items } for every view, or { [view]: { ... } }
      const byView = tickets[config.params.view] ?? tickets;
      const items =
        byView[config.params.open ? "open" : config.params.status] ?? [];
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
    { route: `/departments/d-cp/tickets${search}`, queryClient },
  );
  return asked;
}

describe("Work queue", () => {
  it("a requester without department access gets the no-access page", async () => {
    const asked = renderQueue(["Requester"], { departments: [] });
    expect(await screen.findByText("No access page")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it("a head starts on All open: one call with open=true for the unit; New shows Waiting", async () => {
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
        open: [
          item("CP-2026-000002", 1, "2026-11-03T10:00:00Z"),
          item(
            "CP-2026-000001",
            4,
            "2026-11-02T10:00:00Z",
            CW1,
            "2026-11-02T10:00:05Z",
          ),
        ],
      },
    );
    expect(
      await screen.findByRole("tab", { name: "All open" }),
    ).toHaveAttribute("aria-selected", "true");
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
    expect(within(rows[0]).getByText("Waiting")).toBeInTheDocument();
    expect(within(rows[0]).getByText("New")).toBeInTheDocument();
    expect(within(rows[1]).getByText("test.caseworker1")).toBeInTheDocument();
    const assigned = within(rows[1]).getByText(/days? ago/);
    expect(assigned.closest("span")).toHaveTextContent(/^Assigned /);
    expect(assigned).toHaveAttribute("title", "Mon 2 Nov 2026, 11:00 WAT");
    expect(screen.getByLabelText("Unit")).toHaveDisplayValue(
      "Contribution Matching",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      view: "department",
      departmentId: "d-cp",
      unitId: "u-cm",
      open: true,
    });
    expect(asked[0].status).toBeUndefined();
  });

  it("a case worker starts on Assigned to me: departmentId sent, the oldest unstarted ticket on top", async () => {
    const user = userEvent.setup();
    const asked = renderQueue(
      ["Requester", "CaseWorker"],
      {
        departments: [
          {
            ...CP,
            isHod: false,
            units: [unit("u-cm", "Contribution Matching", { isMember: true })],
          },
        ],
      },
      {
        assigned: {
          open: [
            item(
              "CP-2026-000012",
              3,
              "2026-11-03T13:00:00Z",
              CW1,
              "2026-11-03T07:00:00Z",
            ),
            item(
              "CP-2026-000011",
              2,
              "2026-11-03T12:00:00Z",
              CW1,
              "2026-11-03T12:00:00Z",
            ),
            item(
              "CP-2026-000010",
              2,
              "2026-11-03T11:00:00Z",
              CW1,
              "2026-11-03T11:00:00Z",
            ),
          ],
        },
        department: {
          open: [item("CP-2026-000020", 1, "2026-11-03T12:00:00Z")],
        },
      },
    );
    expect(
      await screen.findByRole("tab", { name: "Assigned to me" }),
    ).toHaveAttribute("aria-selected", "true");
    const rows = await screen.findAllByTestId(/^ticket-row-/);
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "ticket-row-CP-2026-000010",
      "ticket-row-CP-2026-000011",
      "ticket-row-CP-2026-000012",
    ]);
    expect(screen.queryByLabelText("Unit")).not.toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      view: "assigned",
      departmentId: "d-cp",
      open: true,
    });

    await user.click(screen.getByRole("tab", { name: "All open" }));
    expect(
      await screen.findByTestId("ticket-row-CP-2026-000020"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toHaveDisplayValue(
      "Contribution Matching",
    );
  });

  it("opens filtered from a Home card: Waiting to start asks for Assigned and Reopened", async () => {
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
        assigned: {
          2: [item("CP-2026-000030", 2, "2026-11-03T11:00:00Z", CW1)],
          6: [item("CP-2026-000031", 6, "2026-11-03T12:00:00Z", CW1)],
        },
      },
      "?tab=assigned&status=start",
    );
    expect(
      await screen.findByRole("tab", { name: "Assigned to me" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Status")).toHaveDisplayValue(
      "Waiting to start",
    );
    expect(await screen.findAllByTestId(/^ticket-row-/)).toHaveLength(2);
    expect(asked.map((query) => query.status).sort()).toEqual([2, 6]);
  });
});
