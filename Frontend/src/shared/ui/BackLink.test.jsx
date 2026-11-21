import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import PageHeader from "./PageHeader.jsx";

function renderAt(entries) {
  const router = createMemoryRouter(
    [
      { path: "/tickets", element: <p>My requests</p> },
      { path: "/departments/d-cp/tickets", element: <p>Work queue</p> },
      {
        path: "/tickets/:reference",
        element: <PageHeader title="A ticket" back="/tickets" />,
      },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Back", () => {
  it("returns to the page the person came from in the app", async () => {
    const router = renderAt(["/departments/d-cp/tickets", "/tickets/CP-1"]);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Work queue")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/departments/d-cp/tickets");
  });

  it("goes to the page above when the person landed here directly", async () => {
    const router = renderAt(["/tickets/CP-1"]);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("My requests")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/tickets");
  });

  it("is not shown unless the page asks for it", () => {
    const router = createMemoryRouter(
      [{ path: "*", element: <PageHeader title="Reports" /> }],
      { initialEntries: ["/reports"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
