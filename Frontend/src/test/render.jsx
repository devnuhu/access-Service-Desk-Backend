import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/shared/ui";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Renders with the app's providers and a memory router at `route`. */
export function renderWithProviders(
  ui,
  { route = "/", queryClient = createTestQueryClient() } = {},
) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
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
