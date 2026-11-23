import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import MyRequestsPage from "./MyRequestsPage.jsx";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const row = (n, status, overrides = {}) => ({
  id: `t-${n}`,
  reference: `CP-2026-00000${n}`,
  subject: `Subject ${n}`,
  departmentCode: "CP",
  categoryName: "Account Reconciliation",
  unitName: "Contribution Matching",
  locationName: "HQ",
  priority: 2,
  status,
  requester: { userId: "u-r", userName: "test.requester", fullName: null },
  assignee: null,
  assignedAt: null,
  firstRespondedAt: null,
  escalatedToHeadAt: null,
  slaLevel: 0,
  slaDueAt: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: null,
  ...overrides,
});

function renderMyRequests(search, items = []) {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    "GET /api/tickets": (config) => {
      asked.push(config.params);
      return [200, { items, total: items.length, page: 1, pageSize: 20 }];
    },
  });
  const { router } = renderWithProviders(<MyRequestsPage />, {
    route: `/tickets${search}`,
    queryClient,
  });
  asked.router = router;
  return asked;
}

describe("My requests", () => {
  it("opens filtered from a Home tile (?status=open)", async () => {
    const asked = renderMyRequests("?status=open");
    expect(await screen.findByLabelText("Status")).toHaveValue("open");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({ view: "mine", open: true }),
    );
  });

  it("opens on the tickets waiting for my confirmation (?status=5, Resolved)", async () => {
    const asked = renderMyRequests("?status=5");
    expect(await screen.findByLabelText("Status")).toHaveValue("5");
    await waitFor(() =>
      expect(asked[0]).toMatchObject({ view: "mine", status: 5 }),
    );
    expect(asked[0].open).toBeUndefined();
  });

  it("a Pending row shows who it waits on and for how long; other rows show no chip", async () => {
    renderMyRequests("", [
      row(1, 4, { pendingReason: 1, pendingSince: daysAgo(5) }),
      row(2, 4, { pendingReason: 2, pendingSince: daysAgo(10) }),
      row(3, 3),
    ]);
    const first = await screen.findByTestId("ticket-row-CP-2026-000001");
    expect(within(first).getByTestId("pending-wait")).toHaveTextContent(
      "Waiting on requester · 5d",
    );
    expect(within(first).getByTestId("pending-wait")).toHaveAttribute(
      "data-tone",
      "amber",
    );
    const second = screen.getByTestId("ticket-row-CP-2026-000002");
    expect(within(second).getByTestId("pending-wait")).toHaveTextContent(
      "Waiting on third party · 10d",
    );
    expect(within(second).getByTestId("pending-wait")).toHaveAttribute(
      "data-tone",
      "red",
    );
    expect(
      within(screen.getByTestId("ticket-row-CP-2026-000003")).queryByTestId(
        "pending-wait",
      ),
    ).toBeNull();
  });

  it("has a Priority filter (no age): read from and written to the address", async () => {
    const user = userEvent.setup();
    const asked = renderMyRequests("?priority=2");
    const priority = await screen.findByLabelText("Priority");
    expect(priority).toHaveValue("2");
    expect(screen.queryByLabelText("Age")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(asked[0]).toMatchObject({ view: "mine", priority: 2 }),
    );
    expect(
      await screen.findByText("No tickets match these filters."),
    ).toBeInTheDocument();
    expect(
      within(priority)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All priorities", "Critical", "High", "Medium", "Low"]);

    await user.selectOptions(priority, "Critical");
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ priority: 4 }));
    expect(asked.router.state.location.search).toBe("?priority=4");

    await user.selectOptions(priority, "All priorities");
    await waitFor(() => expect(asked.at(-1).priority).toBeUndefined());
    expect(asked.router.state.location.search).toBe("");
  });
});
