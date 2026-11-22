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
import PriorityMatrixPage from "./PriorityMatrixPage.jsx";

const builtIn = (impact, urgency) => {
  const sum = impact + urgency;
  return sum >= 8 ? 4 : sum >= 6 ? 3 : sum >= 4 ? 2 : 1;
};

/** The built-in matrix with `edited` cells ({ "impact-urgency": priority }) changed. */
function matrix(edited = {}) {
  return {
    impacts: [
      { value: 1, label: "Just me", description: "" },
      { value: 2, label: "My team", description: "" },
      { value: 3, label: "My department", description: "" },
      { value: 4, label: "The whole company", description: "" },
    ],
    urgencies: [
      { value: 1, label: "It can wait", description: "" },
      { value: 2, label: "Soon", description: "" },
      { value: 3, label: "Urgent", description: "" },
      { value: 4, label: "I cannot work", description: "" },
    ],
    cells: [1, 2, 3, 4].flatMap((impact) =>
      [1, 2, 3, 4].map((urgency) => {
        const changed = edited[`${impact}-${urgency}`];
        return {
          impact,
          urgency,
          priority: changed ?? builtIn(impact, urgency),
          isDefault: changed === undefined,
        };
      }),
    ),
  };
}

function renderPage({ edited = { "2-2": 4 }, put } = {}) {
  const queryClient = createTestQueryClient();
  const state = { edited: { ...edited }, sent: [] };
  installFakeApi(queryClient, {
    "GET /api/priority-matrix": () => [200, matrix(state.edited)],
    "PUT /api/admin/priority-matrix": ({ body }) => {
      state.sent.push(body);
      if (put) return put(body);
      for (const cell of body.cells) {
        const key = `${cell.impact}-${cell.urgency}`;
        if (cell.priority === builtIn(cell.impact, cell.urgency))
          delete state.edited[key];
        else state.edited[key] = cell.priority;
      }
      return [200, matrix(state.edited)];
    },
  });
  renderWithProviders(<PriorityMatrixPage />, { queryClient });
  return state;
}

const cell = (impact, urgency) =>
  screen.getByLabelText(`${impact}, ${urgency}`);

describe("Priority matrix", () => {
  it("shows impact rows and urgency columns, marks default and edited cells, and saves only the changed cells", async () => {
    const user = userEvent.setup();
    const state = renderPage();
    await screen.findByRole("heading", { name: "Priority matrix" });

    const rows = screen.getAllByRole("rowheader").map((th) => th.textContent);
    expect(rows).toEqual([
      "Just me",
      "My team",
      "My department",
      "The whole company",
    ]);
    const columns = screen
      .getAllByRole("columnheader")
      .slice(1)
      .map((th) => th.textContent);
    expect(columns).toEqual(["It can wait", "Soon", "Urgent", "I cannot work"]);

    expect(cell("Just me", "It can wait")).toHaveDisplayValue("Low");
    expect(cell("The whole company", "I cannot work")).toHaveDisplayValue(
      "Critical",
    );
    expect(screen.getByTestId("cell-1-1")).toHaveTextContent("default");
    expect(cell("My team", "Soon")).toHaveDisplayValue("Critical");
    expect(screen.getByTestId("cell-2-2")).toHaveTextContent("Edited");
    expect(screen.getByTestId("cell-2-2")).not.toHaveTextContent("default");
    expect(
      screen.getByText(/Changes apply to requests raised from now on\./),
    ).toHaveTextContent(
      "Tickets already raised keep their priority. The service levels (response and resolution times) follow the priority.",
    );

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    // Two cells changed, one of them changed back: only one goes.
    await user.selectOptions(cell("Just me", "Urgent"), "High");
    await user.selectOptions(cell("My department", "Soon"), "Low");
    await user.selectOptions(cell("My department", "Soon"), "Medium");
    expect(screen.getByTestId("cell-1-3")).toHaveTextContent("Unsaved");
    await user.click(save);

    expect(await screen.findByText(/1 cell saved\./)).toBeInTheDocument();
    expect(state.sent).toEqual([
      { cells: [{ impact: 1, urgency: 3, priority: 3 }] },
    ]);
    // The answer refreshed the grid: the cell is now an edited one.
    await waitFor(() =>
      expect(screen.getByTestId("cell-1-3")).toHaveTextContent("Edited"),
    );
    expect(cell("Just me", "Urgent")).toHaveDisplayValue("High");
    expect(save).toBeDisabled();
  });

  it("Reset all to default sends every edited cell at its default, after confirming", async () => {
    const user = userEvent.setup();
    const state = renderPage({ edited: { "2-2": 4, "4-1": 1 } });
    await user.click(
      await screen.findByRole("button", { name: "Reset all to default" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Reset the priority matrix?",
    });
    expect(dialog).toHaveTextContent("2 edited cells go back to the default.");
    await user.click(
      within(dialog).getByRole("button", { name: "Reset all to default" }),
    );
    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0]).toEqual({
      cells: [
        { impact: 2, urgency: 2, priority: 2 },
        { impact: 4, urgency: 1, priority: 2 },
      ],
    });
    expect(
      await screen.findByText("The priority matrix is back to its defaults."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reset all to default" }),
      ).toBeDisabled(),
    );
    expect(cell("My team", "Soon")).toHaveDisplayValue("Medium");
  });

  it("shows a 400's message and keeps the unsaved choice", async () => {
    const user = userEvent.setup();
    renderPage({
      put: () => [400, { message: "Each cell may be sent only once." }],
    });
    await user.selectOptions(
      await screen.findByLabelText("Just me, Soon"),
      "4",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each cell may be sent only once.",
    );
    expect(cell("Just me", "Soon")).toHaveDisplayValue("Critical");
  });

  it("a 403 on save says the page is for Super Admin only; the menu item is offered to Super Admin only", async () => {
    const user = userEvent.setup();
    renderPage({ put: () => [403, { message: "Forbidden." }] });
    await user.selectOptions(
      await screen.findByLabelText("Just me, Soon"),
      "4",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This page is for Super Admin only.",
    );

    const items = (roles) =>
      buildNavigation(makeUser({ roles }), { departments: [] }).flatMap(
        (section) => section.items,
      );
    expect(items(["Requester", "HOD"]).map((item) => item.label)).not.toContain(
      "Priority matrix",
    );
    const admin = items(["Requester", "SuperAdmin"]);
    const at = admin.findIndex((item) => item.label === "Priority matrix");
    expect(admin[at].to).toBe("/admin/priority-matrix");
    expect(admin[at - 1].label).toBe("Service levels");
  });
});
