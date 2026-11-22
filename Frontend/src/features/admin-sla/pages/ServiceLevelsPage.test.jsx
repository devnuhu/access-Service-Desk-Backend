import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildNavigation } from "@/layouts/navigation.js";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import ServiceLevelsPage from "./ServiceLevelsPage.jsx";

const row = (priority, response, resolution, overrides = {}) => ({
  id: null,
  scope: "global",
  departmentId: null,
  departmentName: null,
  categoryId: null,
  categoryName: null,
  priority,
  responseHours: response,
  resolutionHours: resolution,
  isDefault: true,
  ...overrides,
});

const POLICIES = {
  global: [
    row(4, 1, 8),
    row(3, 2, 16, { id: "p-high", isDefault: false }),
    row(2, 4, 24),
    row(1, 8, 40),
  ],
  overrides: [
    row(3, 1, 8, {
      id: "p-ref",
      scope: "category",
      categoryId: "c-ref",
      categoryName: "Refund request",
      departmentId: "d-cp",
      departmentName: "Contribution Processing",
      isDefault: false,
    }),
  ],
};

function renderPage(routes = {}) {
  const queryClient = createTestQueryClient();
  const sent = [];
  installFakeApi(queryClient, {
    "GET /api/admin/sla-policies": () => [200, POLICIES],
    "GET /api/org/departments": () => [
      200,
      [{ id: "d-cp", code: "CP", name: "Contribution Processing", units: [] }],
    ],
    "GET /api/admin/categories": () => [
      200,
      [
        {
          id: "c-uc",
          departmentId: "d-cp",
          departmentName: "Contribution Processing",
          unitId: "u-cm",
          unitName: "Contribution Matching",
          name: "Unmatched contribution",
          description: null,
          timelineHours: 24,
          defaultPriority: 2,
          sortOrder: 1,
          isActive: true,
          eligibleCount: 2,
          needsCover: false,
        },
      ],
    ],
    "PUT /api/admin/sla-policies": ({ body }) => {
      sent.push(["PUT", body]);
      return [
        200,
        {
          ...row(body.priority, body.responseHours, body.resolutionHours),
          ...body,
          id: "p-new",
          isDefault: false,
        },
      ];
    },
    "DELETE /api/admin/sla-policies/:id": ({ pathParams }) => {
      sent.push(["DELETE", pathParams.id]);
      return [200, { message: "Back to the level above." }];
    },
    ...routes,
  });
  renderWithProviders(<ServiceLevelsPage />, { queryClient });
  return sent;
}

describe("Service levels", () => {
  it("shows the four default targets, which are built in, and the help", async () => {
    renderPage();
    const critical = await screen.findByTestId("default-Critical");
    expect(critical).toHaveTextContent("1 h");
    expect(critical).toHaveTextContent("8 h");
    expect(within(critical).getByText("Built-in default")).toBeInTheDocument();
    expect(
      within(critical).queryByRole("button", { name: /Reset to default/ }),
    ).toBeNull();
    // A saved default: no badge, and it can be reset.
    const high = screen.getByTestId("default-High");
    expect(within(high).queryByText("Built-in default")).toBeNull();
    expect(
      within(high).getByRole("button", { name: /Reset to default/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sla-help")).toHaveTextContent(
      "Hours are working hours (Mon-Fri 8-5, Lagos, holidays excluded). The most specific level wins: category, then department, then default. First response is counted from when the request is raised.",
    );
    const override = screen.getByTestId("override-Refund request-High");
    expect(override).toHaveTextContent("Category");
  });

  it("edits a default level with PUT", async () => {
    const user = userEvent.setup();
    const sent = renderPage();
    const medium = await screen.findByTestId("default-Medium");
    await user.click(within(medium).getByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Medium: default",
    });
    const response = within(dialog).getByLabelText("First response (hours)");
    await user.clear(response);
    await user.type(response, "3");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual([
      "PUT",
      { scope: "global", priority: 2, responseHours: 3, resolutionHours: 24 },
    ]);
    expect(await screen.findByText("Medium default saved")).toBeInTheDocument();
  });

  it("resets a saved default after confirming", async () => {
    const user = userEvent.setup();
    const sent = renderPage();
    const high = await screen.findByTestId("default-High");
    await user.click(
      within(high).getByRole("button", { name: /Reset to default/ }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Reset High to the built-in default?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(sent).toEqual([["DELETE", "p-high"]]));
  });

  it("adds a category override; the server's message shows on its field", async () => {
    const user = userEvent.setup();
    let refuse = true;
    const sent = renderPage({
      "PUT /api/admin/sla-policies": ({ body }) => {
        sent.push(["PUT", body]);
        if (refuse) {
          refuse = false;
          return [
            400,
            {
              message:
                "The resolution time cannot be shorter than the first-response time.",
            },
          ];
        }
        return [
          200,
          {
            ...row(body.priority, body.responseHours, body.resolutionHours),
            ...body,
            id: "p-new",
            isDefault: false,
            categoryName: "Unmatched contribution",
          },
        ];
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Add override" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add override" });
    await user.click(within(dialog).getByLabelText("Category"));
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Department" }),
      "d-cp",
    );
    const category = within(dialog).getByRole("combobox", { name: "Category" });
    await within(dialog).findByRole("option", {
      name: "Unmatched contribution",
    });
    await user.selectOptions(category, "c-uc");
    await user.selectOptions(within(dialog).getByLabelText("Priority"), "4");
    await user.type(
      within(dialog).getByLabelText("First response (hours)"),
      "2",
    );
    await user.type(within(dialog).getByLabelText("Resolution (hours)"), "6");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const resolution = within(dialog).getByLabelText("Resolution (hours)");
    await waitFor(() =>
      expect(resolution).toHaveAttribute("aria-invalid", "true"),
    );
    expect(resolution).toHaveAccessibleDescription(
      "The resolution time cannot be shorter than the first-response time.",
    );
    expect(sent[0]).toEqual([
      "PUT",
      {
        scope: "category",
        categoryId: "c-uc",
        priority: 4,
        responseHours: 2,
        resolutionHours: 6,
      },
    ]);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add override" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("is for Super Admin only: a 403 says so, and the menu item is not offered to others", async () => {
    renderPage({
      "GET /api/admin/sla-policies": () => [
        403,
        { message: "Only a Super Admin can see or change the service levels." },
      ],
    });
    expect(
      await screen.findByRole("heading", {
        name: "You are not allowed to see this",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only a Super Admin can see or change the service levels.",
      ),
    ).toBeInTheDocument();

    const labels = (roles) =>
      buildNavigation(makeUser({ roles }), { departments: [] })
        .flatMap((section) => section.items)
        .map((item) => item.label);
    expect(labels(["Requester", "HOD"])).not.toContain("Service levels");
    expect(labels(["Requester", "SuperAdmin"])).toContain("Service levels");
  });
});
