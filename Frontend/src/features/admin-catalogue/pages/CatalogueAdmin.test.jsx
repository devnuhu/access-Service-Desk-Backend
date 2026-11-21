import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import CategoriesPage from "./CategoriesPage.jsx";
import SkillsMatrixPage from "./SkillsMatrixPage.jsx";

const ORG_DEPARTMENTS = [
  {
    id: "d-cp",
    code: "CP",
    name: "Contribution Processing",
    units: [
      { id: "u-cm", code: "CM", name: "Contribution Matching" },
      { id: "u-rf", code: "RF", name: "Refund" },
    ],
  },
];

const category = (overrides) => ({
  id: "c-1",
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
  eligibleCount: 3,
  needsCover: false,
  ...overrides,
});

const CATEGORIES = [
  category({
    id: "c-1",
    name: "Unmatched contribution",
    description: "Money received but not matched to an RSA.",
  }),
  category({ id: "c-2", name: "Wrong employer code", sortOrder: 2 }),
  category({
    id: "c-3",
    unitId: "u-rf",
    unitName: "Refund",
    name: "Excess contribution refund",
    sortOrder: 3,
    eligibleCount: 1,
    needsCover: true,
  }),
];

const COVER = [
  {
    categoryId: "c-3",
    categoryName: "Excess contribution refund",
    unitId: "u-rf",
    unitName: "Refund",
    eligibleCount: 1,
  },
];

function renderCategories(routes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/org/departments": () => [200, ORG_DEPARTMENTS],
    "GET /api/admin/categories": () => [200, CATEGORIES],
    "GET /api/admin/categories/cover-warnings": () => [200, COVER],
    ...routes,
  });
  renderWithProviders(
    <Routes>
      <Route path="/admin/categories" element={<CategoriesPage />} />
      <Route path="/admin/units/:unitId/skills" element={<p>Matrix page</p>} />
    </Routes>,
    { route: "/admin/categories", queryClient },
  );
  return api;
}

describe("Categories page", () => {
  it("groups categories by unit, marks Needs cover and lists cover warnings", async () => {
    let askedFor;
    renderCategories({
      "GET /api/admin/categories": ({ params }) => {
        askedFor = params.departmentId;
        return [200, CATEGORIES];
      },
    });
    const cm = await screen.findByTestId("unit-group-u-cm");
    const refund = screen.getByTestId("unit-group-u-rf");
    expect(askedFor).toBe("d-cp");

    expect(within(cm).getByText("Unmatched contribution")).toBeInTheDocument();
    expect(
      within(cm).getByText("Money received but not matched to an RSA."),
    ).toBeInTheDocument();
    expect(within(cm).getByText("Wrong employer code")).toBeInTheDocument();
    expect(within(cm).getAllByText("24 business hours")).toHaveLength(2);
    expect(within(cm).getAllByText("Medium")).toHaveLength(2);
    expect(within(cm).queryByText("Needs cover")).not.toBeInTheDocument();
    expect(
      within(cm).getByRole("link", {
        name: "Skills matrix for Contribution Matching",
      }),
    ).toHaveAttribute("href", "/admin/units/u-cm/skills");

    const refundRow = within(refund)
      .getByText("Excess contribution refund")
      .closest("tr");
    expect(within(refundRow).getByText("Needs cover")).toBeInTheDocument();
    expect(within(refundRow).getByTestId("eligible-count")).toHaveTextContent(
      "1",
    );

    const banner = screen.getByTestId("cover-banner");
    expect(
      within(banner).getByText("1 category has fewer than two case workers"),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText("Excess contribution refund"),
    ).toBeInTheDocument();
    expect(
      within(banner).getByRole("link", { name: "Skills matrix for Refund" }),
    ).toHaveAttribute("href", "/admin/units/u-rf/skills");
  });

  it("hides the cover banner when no category needs cover", async () => {
    renderCategories({
      "GET /api/admin/categories/cover-warnings": () => [200, []],
    });
    await screen.findByTestId("unit-group-u-cm");
    expect(screen.queryByTestId("cover-banner")).not.toBeInTheDocument();
  });

  it("adds a category with unitId, name, timeline and priority, then offers the matrix", async () => {
    let posted;
    renderCategories({
      "POST /api/admin/categories": ({ body }) => {
        posted = body;
        return [
          200,
          category({
            id: "c-new",
            unitId: "u-rf",
            unitName: "Refund",
            name: "Test Category",
            eligibleCount: 0,
            needsCover: true,
          }),
        ];
      },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Add category" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add category" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Unit"),
      "u-rf",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "Test Category",
    );
    expect(
      within(dialog).getByLabelText("Timeline (business hours)"),
    ).toHaveValue(24);
    expect(within(dialog).getByLabelText("Default priority")).toHaveValue("2");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add category" }),
    );

    await waitFor(() =>
      expect(posted).toEqual({
        unitId: "u-rf",
        name: "Test Category",
        timelineHours: 24,
        defaultPriority: 2,
      }),
    );
    const status = screen.getByRole("status");
    expect(
      within(status).getByText(
        "Category Test Category created. Map at least two case workers to it.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(status).getByRole("button", { name: "Open skills matrix" }),
    );
    expect(await screen.findByText("Matrix page")).toBeInTheDocument();
  });

  it("shows a 409 message in the dialog and errors.unitId under Unit", async () => {
    let answer = [
      409,
      {
        message:
          "Contribution Processing already has a category named Wrong employer code.",
        errors: {},
      },
    ];
    renderCategories({ "POST /api/admin/categories": () => answer });
    await userEvent.click(
      await screen.findByRole("button", { name: "Add category" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add category" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Unit"),
      "u-cm",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "Wrong employer code",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add category" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Contribution Processing already has a category named Wrong employer code.",
    );

    answer = [
      400,
      {
        message: "Choose the unit that handles it.",
        errors: { unitId: "Choose a unit." },
      },
    ];
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add category" }),
    );
    expect(await within(dialog).findByText("Choose a unit.")).toHaveAttribute(
      "id",
      "category-unit-error",
    );
    expect(within(dialog).getByLabelText("Unit")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("warns before saving when the unit changes, then sends only the changes", async () => {
    let patched;
    renderCategories({
      "PATCH /api/admin/categories/:categoryId": ({ body, pathParams }) => {
        patched = { id: pathParams.categoryId, body };
        return [
          200,
          {
            message:
              "Category Wrong employer code updated. Moved to Refund. 2 case worker mappings were removed. Map case workers of Refund to it.",
          },
        ];
      },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Wrong employer code" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Edit Wrong employer code",
    });
    expect(within(dialog).getByLabelText("Order")).toHaveValue(2);
    expect(screen.queryByTestId("move-warning")).not.toBeInTheDocument();

    await userEvent.selectOptions(
      within(dialog).getByLabelText("Unit"),
      "u-rf",
    );
    expect(screen.getByTestId("move-warning")).toHaveTextContent(
      "Case workers who are not in Refund will stop handling this category.",
    );
    expect(patched).toBeUndefined();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Move and save" }),
    );
    await waitFor(() =>
      expect(patched).toEqual({ id: "c-2", body: { unitId: "u-rf" } }),
    );
    expect(
      await within(screen.getByRole("status")).findByText(
        /2 case worker mappings were removed/,
      ),
    ).toBeInTheDocument();
  });

  it("switches a category off after confirmation", async () => {
    let patched;
    renderCategories({
      "PATCH /api/admin/categories/:categoryId": ({ body }) => {
        patched = body;
        return [200, { message: "Category Unmatched contribution updated." }];
      },
    });
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Switch off Unmatched contribution",
      }),
    );
    const confirm = screen.getByRole("dialog", {
      name: "Switch off Unmatched contribution?",
    });
    expect(confirm).toHaveTextContent(
      "Requesters will no longer see it. Open tickets are not affected.",
    );
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Switch off" }),
    );
    await waitFor(() => expect(patched).toEqual({ isActive: false }));
  });

  it("moves a category down by swapping the order with its neighbour", async () => {
    const patches = [];
    renderCategories({
      "PATCH /api/admin/categories/:categoryId": ({ body, pathParams }) => {
        patches.push([pathParams.categoryId, body.sortOrder]);
        return [200, { message: "updated" }];
      },
    });
    const cm = await screen.findByTestId("unit-group-u-cm");
    expect(
      within(cm).getByRole("button", {
        name: "Move Unmatched contribution up",
      }),
    ).toBeDisabled();
    await userEvent.click(
      within(cm).getByRole("button", {
        name: "Move Unmatched contribution down",
      }),
    );
    await waitFor(() =>
      expect(patches).toEqual([
        ["c-1", 2],
        ["c-2", 1],
      ]),
    );
  });
});

// ---------------- skills matrix ----------------

const member = (overrides) => ({
  userId: "p-cw1",
  userName: "test.caseworker1",
  fullName: "Test Caseworker1",
  staffCategory: 1,
  accountActive: true,
  categoryIds: [],
  ...overrides,
});

const MATRIX = {
  unitId: "u-rf",
  unitName: "Refund",
  categories: [
    { id: "c-a", name: "Excess refund", isActive: true, eligibleCount: 2 },
    { id: "c-b", name: "Test Category", isActive: true, eligibleCount: 0 },
    { id: "c-off", name: "Old refund", isActive: false, eligibleCount: 0 },
  ],
  members: [
    member({
      userId: "p-hou2",
      userName: "test.hou2",
      fullName: "Test HOU2",
      categoryIds: ["c-a"],
    }),
    member({
      userId: "p-cw2",
      userName: "test.caseworker2",
      fullName: "Test Caseworker2",
      categoryIds: ["c-a"],
    }),
    member({
      userId: "p-cw4",
      userName: "test.caseworker4",
      fullName: "Test Caseworker4",
      accountActive: false,
    }),
    // The unit's head: ticks kept, never used for automatic assignment or cover.
    member({
      userId: "p-head",
      userName: "test.hou",
      fullName: "Test Head",
      staffCategory: 2,
      isHead: true,
      categoryIds: ["c-a"],
    }),
  ],
  warnings: [
    {
      categoryId: "c-b",
      categoryName: "Test Category",
      unitId: "u-rf",
      unitName: "Refund",
      eligibleCount: 0,
    },
  ],
};

function renderMatrix(routes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/org/departments": () => [200, ORG_DEPARTMENTS],
    "GET /api/admin/units/:unitId/skills": () => [200, MATRIX],
    ...routes,
  });
  const view = renderWithProviders(
    <Routes>
      <Route
        path="/admin/units/:unitId/skills"
        element={<SkillsMatrixPage />}
      />
      <Route path="/admin/categories" element={<p>Categories page</p>} />
    </Routes>,
    { route: "/admin/units/u-rf/skills", queryClient },
  );
  return { api, ...view };
}

const cell = (categoryName, personName) =>
  screen.getByRole("checkbox", { name: `${categoryName} for ${personName}` });

describe("Skills matrix", () => {
  // The trail (Units > department > unit > Skills) is drawn by the app layout: Layout.test.jsx.
  it("shows members, chips, warnings and counts", async () => {
    renderMatrix();
    expect(
      await screen.findByRole("heading", { name: "Refund: skills matrix" }),
    ).toBeInTheDocument();
    // The head: greyed, a Head badge and the note, ticks shown but boxes disabled, no All/None.
    const head = screen.getByTestId("row-p-head");
    expect(head).toHaveAttribute("data-head", "true");
    expect(within(head).getByText("Head")).toBeInTheDocument();
    expect(within(head).getByTestId("head-note")).toHaveTextContent(
      "Heads are not assigned automatically",
    );
    expect(cell("Excess refund", "Test Head")).toBeChecked();
    expect(cell("Excess refund", "Test Head")).toBeDisabled();
    expect(cell("Test Category", "Test Head")).toBeDisabled();
    expect(
      within(head).queryByRole("button", { name: /every category/ }),
    ).toBeNull();
    // Other rows stay as they were.
    expect(screen.getByTestId("row-p-hou2")).not.toHaveAttribute("data-head");
    expect(cell("Test Category", "Test HOU2")).toBeEnabled();
    expect(
      within(screen.getByTestId("row-p-cw4")).getByText("Blocked"),
    ).toBeInTheDocument();
    expect(cell("Excess refund", "Test HOU2")).toBeChecked();
    expect(screen.getByTestId("cover-banner")).toHaveTextContent(
      "Test Category",
    );
    expect(screen.getByTestId("footer-count-c-a")).toHaveTextContent("2");
    expect(screen.getByTestId("footer-count-c-b")).toHaveClass(
      "text-brand-orange-ink",
    );
    expect(screen.getByTestId("footer-count-c-a")).not.toHaveClass(
      "text-brand-orange-ink",
    );
  });

  it("ticking marks the row changed and updates the footer; Save sends one PUT per changed person", async () => {
    const puts = [];
    renderMatrix({
      "PUT /api/admin/units/:unitId/skills/:userId": ({ pathParams, body }) => {
        puts.push([pathParams.unitId, pathParams.userId, body.categoryIds]);
        return pathParams.userId === "p-cw2"
          ? [
              200,
              {
                message:
                  "Test Caseworker2 now handles 2 categories in Refund. Fewer than two case workers handle: Test Category.",
              },
            ]
          : [200, { message: "Test HOU2 now handles 0 categories in Refund." }];
      },
    });
    await screen.findByTestId("row-p-cw2");

    await userEvent.click(cell("Test Category", "Test Caseworker2"));
    expect(
      within(screen.getByTestId("row-p-cw2")).getByTestId("row-changed"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("footer-count-c-b")).toHaveTextContent("1");
    expect(screen.getByText("1 person changed")).toBeInTheDocument();

    // "None" for the head clears their set.
    await userEvent.click(
      screen.getByRole("button", {
        name: "Clear every category for Test HOU2",
      }),
    );
    expect(screen.getByTestId("footer-count-c-a")).toHaveTextContent("1");
    expect(screen.getByText("2 people changed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(puts).toEqual([
        ["u-rf", "p-hou2", []],
        ["u-rf", "p-cw2", ["c-a", "c-b"]],
      ]),
    );
    const warning = await screen.findByText(
      /Fewer than two case workers handle: Test Category/,
    );
    expect(warning.closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(
      screen
        .getByText("Test HOU2 now handles 0 categories in Refund.")
        .closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "success");
    await waitFor(() =>
      expect(screen.queryByText(/people changed/)).not.toBeInTheDocument(),
    );
  });

  it("stops at a failed PUT, shows its message and keeps the unsaved rows marked", async () => {
    const puts = [];
    renderMatrix({
      "PUT /api/admin/units/:unitId/skills/:userId": ({ pathParams }) => {
        puts.push(pathParams.userId);
        return pathParams.userId === "p-hou2"
          ? [
              400,
              {
                message:
                  "Only members of Refund can handle its categories. Add them to the unit first.",
                errors: {},
              },
            ]
          : [200, { message: "saved" }];
      },
    });
    await screen.findByTestId("row-p-cw2");
    await userEvent.click(cell("Test Category", "Test HOU2"));
    await userEvent.click(cell("Test Category", "Test Caseworker2"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(/Only members of Refund can handle/),
    ).toBeInTheDocument();
    expect(puts).toEqual(["p-hou2"]);
    expect(screen.getByText("2 people changed")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("row-p-hou2")).getByText("Not saved"),
    ).toBeInTheDocument();
  });

  it("keeps a tick made while a save is running", async () => {
    let finishPut;
    const puts = [];
    renderMatrix({
      "PUT /api/admin/units/:unitId/skills/:userId": ({ pathParams, body }) => {
        puts.push([pathParams.userId, body.categoryIds]);
        // The first PUT is held open while the person ticks another row.
        if (puts.length === 1)
          return new Promise((resolve) => {
            finishPut = () => resolve([200, { message: "saved" }]);
          });
        return [200, { message: "saved" }];
      },
    });
    await screen.findByTestId("row-p-cw2");
    await userEvent.click(cell("Test Category", "Test Caseworker2"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));

    await userEvent.click(cell("Test Category", "Test HOU2"));
    finishPut();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    expect(cell("Test Category", "Test HOU2")).toBeChecked();
    expect(screen.getByText("1 person changed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(puts).toEqual([
        ["p-cw2", ["c-a", "c-b"]],
        ["p-hou2", ["c-a", "c-b"]],
      ]),
    );
  });

  it("Discard restores the API's ticks", async () => {
    renderMatrix();
    await screen.findByTestId("row-p-cw2");
    await userEvent.click(cell("Excess refund", "Test Caseworker2"));
    expect(cell("Excess refund", "Test Caseworker2")).not.toBeChecked();
    expect(screen.getByTestId("footer-count-c-a")).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(cell("Excess refund", "Test Caseworker2")).toBeChecked();
    expect(screen.getByTestId("footer-count-c-a")).toHaveTextContent("2");
    expect(screen.queryByText(/changed$/)).not.toBeInTheDocument();
  });

  it("a switched-off category (or a blocked person) cannot be newly ticked", async () => {
    renderMatrix();
    await screen.findByTestId("row-p-cw2");
    const off = cell("Old refund", "Test Caseworker2");
    expect(off).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(off);
    expect(off).not.toBeChecked();
    expect(screen.queryByText(/changed$/)).not.toBeInTheDocument();

    const blocked = cell("Test Category", "Test Caseworker4");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(blocked);
    expect(blocked).not.toBeChecked();

    // "All" skips the switched-off column.
    await userEvent.click(
      screen.getByRole("button", {
        name: "Tick every category for Test Caseworker2",
      }),
    );
    expect(cell("Test Category", "Test Caseworker2")).toBeChecked();
    expect(cell("Old refund", "Test Caseworker2")).not.toBeChecked();
  });

  it("moves between cells with the arrow keys and toggles with Space", async () => {
    renderMatrix();
    await screen.findByTestId("row-p-cw2");
    const first = cell("Excess refund", "Test HOU2");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(cell("Test Category", "Test HOU2")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(cell("Test Category", "Test HOU2")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const target = cell("Test Category", "Test Caseworker2");
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute("tabindex", "0");
    await userEvent.keyboard(" ");
    expect(target).toBeChecked();
    await userEvent.keyboard("{End}");
    expect(cell("Old refund", "Test Caseworker2")).toHaveFocus();
  });

  it("asks before leaving with unsaved changes", async () => {
    renderMatrix();
    await screen.findByTestId("row-p-cw2");
    await userEvent.click(cell("Test Category", "Test Caseworker2"));
    await userEvent.click(screen.getByRole("link", { name: "Categories" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Leave without saving?",
    });
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByText("Categories page")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Categories" }));
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Leave without saving?" }),
      ).getByRole("button", { name: "Leave" }),
    );
    expect(await screen.findByText("Categories page")).toBeInTheDocument();
  });
});
