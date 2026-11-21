import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import MyRequestsPage from "./MyRequestsPage.jsx";

function renderMyRequests(search) {
  const queryClient = createTestQueryClient();
  const asked = [];
  installFakeApi(queryClient, {
    "GET /api/tickets": (config) => {
      asked.push(config.params);
      return [200, { items: [], total: 0, page: 1, pageSize: 20 }];
    },
  });
  renderWithProviders(<MyRequestsPage />, {
    route: `/tickets${search}`,
    queryClient,
  });
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
});
