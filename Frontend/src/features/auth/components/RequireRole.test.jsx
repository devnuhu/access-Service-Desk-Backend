import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import { SESSION_KEY } from "../session.js";
import RequireRole from "./RequireRole.jsx";

function LoginStub() {
  const location = useLocation();
  return <p>Sign-in page {location.search}</p>;
}

function renderGuarded(user, route = "/admin/people") {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(SESSION_KEY, user);
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginStub />} />
      <Route path="/no-access" element={<p>No access page</p>} />
      <Route element={<RequireRole roles={["SuperAdmin"]} />}>
        <Route path="/admin/people" element={<p>People page</p>} />
      </Route>
    </Routes>,
    { route, queryClient },
  );
}

describe("RequireRole", () => {
  it("sends a signed-out person to sign in, coming back afterwards", async () => {
    renderGuarded(null, "/admin/people?search=ada");
    expect(
      await screen.findByText(
        `Sign-in page ?next=${encodeURIComponent("/admin/people?search=ada")}`,
      ),
    ).toBeInTheDocument();
  });

  it("sends someone without the role to the no-access page", async () => {
    renderGuarded(makeUser({ roles: ["Requester", "CaseWorker"] }));
    expect(await screen.findByText("No access page")).toBeInTheDocument();
  });

  it("lets someone with the role through", async () => {
    renderGuarded(makeUser({ roles: ["Requester", "SuperAdmin"] }));
    expect(await screen.findByText("People page")).toBeInTheDocument();
  });
});
