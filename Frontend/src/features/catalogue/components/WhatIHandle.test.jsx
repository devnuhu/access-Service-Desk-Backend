import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import WhatIHandle from "./WhatIHandle.jsx";

function renderPanel(mine) {
  const queryClient = createTestQueryClient();
  installFakeApi(queryClient, {
    "GET /api/catalogue/mine": () => [200, mine],
  });
  renderWithProviders(<WhatIHandle />, { queryClient });
}

describe("What I handle", () => {
  it("groups by unit with the department muted; switched-off categories are muted", async () => {
    renderPanel([
      {
        unitId: "u-cm",
        unitName: "Contribution Matching",
        departmentName: "Contribution Processing",
        categories: [
          { id: "c-1", name: "Account Reconciliation", isActive: true },
          { id: "c-2", name: "Old category", isActive: false },
        ],
      },
      {
        unitId: "u-hr",
        unitName: "Payroll",
        departmentName: "Human Resources",
        categories: [{ id: "c-3", name: "Payslips", isActive: true }],
      },
    ]);
    const unit = await screen.findByTestId("handles-u-cm");
    expect(within(unit).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Contribution Matching Contribution Processing",
    );
    expect(within(unit).getByText("Contribution Processing")).toHaveClass(
      "text-muted",
    );
    expect(within(unit).getByText("Account Reconciliation")).not.toHaveClass(
      "text-muted",
    );
    expect(within(unit).getByText("Old category (off)")).toHaveClass(
      "text-muted",
    );
    expect(
      within(screen.getByTestId("handles-u-hr")).getByText("Payslips"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ask your head of unit to change these."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    renderPanel([]);
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });
});
