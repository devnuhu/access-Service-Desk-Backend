import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import LocationsPage from "./LocationsPage.jsx";

function renderLocations() {
  const queryClient = createTestQueryClient();
  let locations = [
    { id: "l-hq", name: "HQ", sortOrder: 1, isActive: true },
    { id: "l-abj", name: "Abuja", sortOrder: 2, isActive: false },
  ];
  const sent = [];
  installFakeApi(queryClient, {
    "GET /api/admin/locations": () => [200, locations],
    "POST /api/admin/locations": (config) => {
      sent.push(["POST", config.body]);
      const created = {
        id: "l-ph",
        name: config.body.name,
        sortOrder: 3,
        isActive: true,
      };
      locations = [...locations, created];
      return [200, created];
    },
    "PATCH /api/admin/locations/:locationId": (config) => {
      sent.push(["PATCH", config.pathParams.locationId, config.body]);
      if (
        config.body.isActive === false &&
        config.pathParams.locationId === "l-hq"
      ) {
        return [
          400,
          { message: "At least one location must stay on: tickets need one." },
        ];
      }
      locations = locations.map((l) =>
        l.id === config.pathParams.locationId ? { ...l, ...config.body } : l,
      );
      return [200, { message: "Location updated." }];
    },
  });
  renderWithProviders(<LocationsPage />, { queryClient });
  return sent;
}

describe("Locations", () => {
  it("adds a location, reorders, and shows the API's refusal to switch off the last one as a toast", async () => {
    const user = userEvent.setup();
    const sent = renderLocations();
    expect(await screen.findByTestId("location-HQ")).toHaveTextContent("On");
    expect(screen.getByTestId("location-Abuja")).toHaveTextContent("Off");

    await user.click(screen.getByRole("button", { name: "Add location" }));
    const dialog = await screen.findByRole("dialog", { name: "Add location" });
    await user.type(within(dialog).getByLabelText("Name"), "Port Harcourt");
    await user.click(
      within(dialog).getByRole("button", { name: "Add location" }),
    );
    expect(
      await screen.findByText("Location Port Harcourt added."),
    ).toBeInTheDocument();
    expect(sent[0]).toEqual(["POST", { name: "Port Harcourt" }]);
    expect(
      await screen.findByTestId("location-Port Harcourt"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move Abuja up" }));
    await waitFor(() =>
      expect(sent).toContainEqual(["PATCH", "l-abj", { sortOrder: 1 }]),
    );
    expect(sent).toContainEqual(["PATCH", "l-hq", { sortOrder: 2 }]);

    await user.click(screen.getByRole("button", { name: "Switch off HQ" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Switch off HQ?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Switch off" }),
    );
    expect(
      await screen.findByText(
        "At least one location must stay on: tickets need one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-HQ")).toHaveTextContent("On");
  });
});
