import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ToastProvider } from "@/shared/ui";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Renders with the app's providers and a memory data router (like the app's) at `route`. */
export function renderWithProviders(
  ui,
  { route = "/", queryClient = createTestQueryClient() } = {},
) {
  const router = createMemoryRouter([{ path: "*", element: ui }], {
    initialEntries: [route],
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}

/** A signed-in person as GET /api/auth/me returns it (after parsing). */
export function makeUser(overrides = {}) {
  return {
    id: "u-1",
    username: "amaka.obi",
    email: "amaka.obi@example.test",
    fullName: "Amaka Obi",
    firstName: "Amaka",
    lastName: "Obi",
    corporateEmail: null,
    department: "Operations",
    jobTitle: "Officer",
    roles: ["Requester"],
    unreadNotificationCount: 0,
    ...overrides,
  };
}
