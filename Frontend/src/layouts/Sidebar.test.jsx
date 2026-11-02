import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { makeUser } from "@/test/render";
import Sidebar from "./Sidebar.jsx";

const renderFor = (roles) =>
  render(
    <MemoryRouter>
      <Sidebar user={makeUser({ roles })} />
    </MemoryRouter>,
  );

describe("Sidebar", () => {
  it("a Requester sees Home and coming-soon items, no module and no Administration", () => {
    renderFor(["Requester"]);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("My requests")).toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Contribution Processing"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });

  it("a Case Worker sees the module section but no Administration", () => {
    renderFor(["Requester", "CaseWorker"]);
    expect(screen.getByText("Contribution Processing")).toBeInTheDocument();
    expect(screen.getByText("Work queue")).toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("a Super Admin sees Administration with People and roles and Email", () => {
    renderFor(["Requester", "SuperAdmin"]);
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "People and roles" }),
    ).toHaveAttribute("href", "/admin/people");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "/admin/email",
    );
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });

  it("shows coming-soon items as disabled, not as links", () => {
    renderFor(["Requester"]);
    expect(
      screen.queryByRole("link", { name: /My requests/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("My requests").closest("[aria-disabled]"),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
