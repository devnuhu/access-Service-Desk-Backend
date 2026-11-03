import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { clearCsrfToken, getCsrfToken } from "@/shared/lib/http";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import LoginPage from "./LoginPage.jsx";

const ME = makeUser({ roles: ["Requester", "SuperAdmin"] });

const session = {
  statusCode: 200,
  message: "Login successful",
  data: {
    accessToken: "never-read",
    refreshToken: "never-read",
    tokenType: "Bearer",
    accessTokenExpiresAt: "2026-11-02T15:00:00Z",
    csrfToken: "csrf-from-login",
    user: {
      id: ME.id,
      username: ME.username,
      fullName: ME.fullName,
      firstName: "Amaka",
      roles: ME.roles,
    },
  },
  errors: {},
};

function renderLoginWithContainer() {
  const queryClient = createTestQueryClient();
  installFakeApi(queryClient, signedOut);
  return renderWithProviders(<LoginPage />, { route: "/login", queryClient });
}

function renderLogin(route, routes) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, routes);
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/people" element={<p>People page</p>} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    { route, queryClient },
  );
  return api;
}

const signedOut = {
  "GET /api/Auth/me": () => [401, ""],
  "POST /api/Auth/refresh": () => [
    400,
    { statusCode: 400, message: "Refresh token is required." },
  ],
};

afterEach(() => clearCsrfToken());

describe("LoginPage", () => {
  it("focuses the username field and requires both fields", async () => {
    renderLogin("/login", signedOut);
    const username = await screen.findByLabelText("Username");
    await waitFor(() => expect(username).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Enter your username.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  });

  it("shows the light brand panel with the illustration and no rings", async () => {
    const { container } = renderLoginWithContainer();
    expect(
      await screen.findByRole("img", {
        name: "A service desk agent with a headset answering requests at a laptop",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Every request, to the right team, on time."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Updates by email\s*and in the app/),
    ).toBeInTheDocument();
    expect(container.querySelector("circle[r='250']")).toBeNull();
  });

  it("shows the API message on 401 and moves focus to it", async () => {
    renderLogin("/login", {
      ...signedOut,
      "POST /api/Auth/login": () => [
        401,
        { statusCode: 401, message: "Invalid username or password." },
      ],
    });
    await userEvent.type(
      await screen.findByLabelText("Username"),
      "Adeyemi.Salisu",
    );
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid username or password.");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("shows the fixed text for 429", async () => {
    renderLogin("/login", {
      ...signedOut,
      "POST /api/Auth/login": () => [429, ""],
    });
    await userEvent.type(await screen.findByLabelText("Username"), "a");
    await userEvent.type(screen.getByLabelText("Password"), "b");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a minute and try again.",
    );
  });

  it("redirects to next on success and keeps the CSRF token in memory", async () => {
    let signedIn = false;
    renderLogin("/login?next=%2Fadmin%2Fpeople", {
      ...signedOut,
      "GET /api/Auth/me": () =>
        signedIn
          ? [200, { statusCode: 200, message: "", data: ME, errors: {} }]
          : [401, ""],
      "POST /api/Auth/login": ({ body }) => {
        expect(body).toEqual({
          username: "Adeyemi.Salisu",
          password: "secret",
        });
        signedIn = true;
        return [200, session];
      },
    });
    await userEvent.type(
      await screen.findByLabelText("Username"),
      "Adeyemi.Salisu",
    );
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("People page")).toBeInTheDocument();
    expect(getCsrfToken()).toBe("csrf-from-login");
  });

  it("ignores a next that is not a local path", async () => {
    let signedIn = false;
    renderLogin("/login?next=%2F%2Fevil.example", {
      ...signedOut,
      "GET /api/Auth/me": () =>
        signedIn
          ? [200, { statusCode: 200, message: "", data: ME, errors: {} }]
          : [401, ""],
      "POST /api/Auth/login": () => {
        signedIn = true;
        return [200, session];
      },
    });
    await userEvent.type(await screen.findByLabelText("Username"), "a");
    await userEvent.type(screen.getByLabelText("Password"), "b");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Home page")).toBeInTheDocument();
  });
});
