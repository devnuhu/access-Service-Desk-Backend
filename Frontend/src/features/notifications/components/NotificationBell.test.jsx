import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryObserver } from "@tanstack/react-query";
import { useSession } from "@/features/auth";
import { MY_CATEGORIES_KEY } from "@/features/catalogue";
import { useMyOrganisation } from "@/features/org";
import { ticketKeys } from "@/features/tickets";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import NotificationBell from "./NotificationBell.jsx";

// A fake SignalR connection: the test calls the handlers the bell registers.
const hub = vi.hoisted(() => ({ handlers: {}, started: 0, stopped: 0 }));
vi.mock("../api/hub.js", () => ({
  createNotificationConnection: () => ({
    on: (name, handler) => {
      hub.handlers[name] = handler;
    },
    onreconnected: () => {},
    start: async () => {
      hub.started += 1;
    },
    stop: async () => {
      hub.stopped += 1;
    },
  }),
}));

const item = (overrides) => ({
  id: "n-1",
  title: "Welcome",
  message: "Access Desk is ready.",
  type: 0,
  category: 0,
  relatedEntityType: null,
  relatedEntityId: null,
  deepLinkUrl: null,
  isRead: false,
  readAt: null,
  createdAt: "2026-11-02T14:42:00Z",
  isActionRequired: false,
  ...overrides,
});

function renderBell(routes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/notifications/unread-count": () => [200, { count: 1 }],
    "GET /api/notifications": () => [
      200,
      { items: [item()], total: 1, unread: 1, page: 1, pageSize: 10 },
    ],
    ...routes,
  });
  const view = renderWithProviders(<NotificationBell />, { queryClient });
  return { api, ...view };
}

beforeEach(() => {
  hub.handlers = {};
  hub.started = 0;
  hub.stopped = 0;
});

describe("NotificationBell", () => {
  it("a pushed notification increases the count, appears first and shows a toast", async () => {
    renderBell();
    expect(await screen.findByTestId("bell-count")).toHaveTextContent("1");
    await userEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" }),
    );
    const list = await screen.findByTestId("notification-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(hub.started).toBe(1);

    act(() => {
      hub.handlers.ReceiveNotification(
        item({
          id: "n-2",
          title: "Role given",
          message: "You are now a Head of Unit.",
          type: 3,
          isActionRequired: true,
          createdAt: "2026-11-02T15:00:00Z",
        }),
      );
    });

    // The query cache notifies the bell on the next tick.
    await waitFor(() =>
      expect(screen.getByTestId("bell-count")).toHaveTextContent("2"),
    );
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Role given");
    expect(items[0]).toHaveTextContent("Mon 2 Nov 2026, 16:00 WAT");
    expect(
      within(screen.getByRole("status")).getByText(
        "You are now a Head of Unit.",
      ),
    ).toBeInTheDocument();
  });

  it("shows 99+ for large counts", async () => {
    renderBell({
      "GET /api/notifications/unread-count": () => [200, { count: 150 }],
    });
    expect(await screen.findByTestId("bell-count")).toHaveTextContent("99+");
  });

  it("marks an item read on click and lowers the count", async () => {
    let marked;
    renderBell({
      "PATCH /api/notifications/:id/read": ({ pathParams }) => {
        marked = pathParams.id;
        return [204, ""];
      },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Welcome/ }),
    );
    expect(marked).toBe("n-1");
    expect(screen.queryByTestId("bell-count")).not.toBeInTheDocument();
  });

  it("stops the connection when the shell goes away (sign-out)", async () => {
    const { unmount } = renderBell();
    await screen.findByTestId("bell-count");
    unmount();
    expect(hub.stopped).toBe(1);
  });

  it('a pushed notification with relatedEntityType "User" refetches auth/me and org/me', async () => {
    let meCalls = 0;
    let orgCalls = 0;
    const queryClient = createTestQueryClient();
    installFakeApi(queryClient, {
      "GET /api/notifications/unread-count": () => [200, { count: 0 }],
      "GET /api/notifications": () => [
        200,
        { items: [], total: 0, unread: 0, page: 1, pageSize: 10 },
      ],
      "GET /api/Auth/me": () => {
        meCalls += 1;
        const roles = meCalls > 1 ? ["Requester", "CaseWorker"] : ["Requester"];
        return [
          200,
          {
            statusCode: 200,
            message: "",
            data: makeUser({ roles }),
            errors: {},
          },
        ];
      },
      "GET /api/Auth/csrf": () => [
        200,
        { statusCode: 200, message: "", data: "t", errors: {} },
      ],
      "GET /api/org/me": () => {
        orgCalls += 1;
        return [200, { departments: [] }];
      },
    });
    // The shell watches both queries (RequireRole, Sidebar); this stands in for it.
    function Shell() {
      const { user } = useSession();
      useMyOrganisation();
      return (
        <>
          <p>Roles: {user?.roles.join(", ")}</p>
          <NotificationBell />
        </>
      );
    }
    renderWithProviders(<Shell />, { queryClient });
    expect(await screen.findByText("Roles: Requester")).toBeInTheDocument();
    await expect.poll(() => orgCalls).toBe(1);

    act(() => {
      hub.handlers.ReceiveNotification(
        item({
          id: "n-access",
          title: "Your Access Desk access changed",
          message: "You now have the Case Worker role.",
          relatedEntityType: "User",
          relatedEntityId: "u-1",
        }),
      );
    });

    expect(
      await screen.findByText("Roles: Requester, CaseWorker"),
    ).toBeInTheDocument();
    expect(meCalls).toBe(2);
    await expect.poll(() => orgCalls).toBe(2);
  });

  it('two "User" notifications arriving together renew the token once, then refetch auth/me and org/me', async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    let orgCalls = 0;
    let finishRefresh;
    const queryClient = createTestQueryClient();
    installFakeApi(queryClient, {
      "GET /api/notifications/unread-count": () => [200, { count: 0 }],
      "GET /api/notifications": () => [
        200,
        { items: [], total: 0, unread: 0, page: 1, pageSize: 10 },
      ],
      "POST /api/Auth/refresh": () => {
        refreshCalls += 1;
        // Held open until the test lets it finish, so both pushes arrive while it runs.
        return new Promise((resolve) => {
          finishRefresh = () =>
            resolve([
              200,
              {
                statusCode: 200,
                message: "",
                data: {
                  csrfToken: "t2",
                  accessTokenExpiresAt: "2026-11-03T10:15:00Z",
                  user: {
                    id: "u-1",
                    username: "test.requester",
                    fullName: "Test Requester",
                    firstName: "Test",
                    roles: ["Requester", "CaseWorker"],
                  },
                },
                errors: {},
              },
            ]);
        });
      },
      "GET /api/Auth/me": () => {
        meCalls += 1;
        const roles = meCalls > 1 ? ["Requester", "CaseWorker"] : ["Requester"];
        return [
          200,
          {
            statusCode: 200,
            message: "",
            data: makeUser({ roles }),
            errors: {},
          },
        ];
      },
      "GET /api/Auth/csrf": () => [
        200,
        { statusCode: 200, message: "", data: "t", errors: {} },
      ],
      "GET /api/org/me": () => {
        orgCalls += 1;
        return [200, { departments: [] }];
      },
    });
    function Shell() {
      const { user } = useSession();
      useMyOrganisation();
      return (
        <>
          <p>Roles: {user?.roles.join(", ")}</p>
          <NotificationBell />
        </>
      );
    }
    renderWithProviders(<Shell />, { queryClient });
    expect(await screen.findByText("Roles: Requester")).toBeInTheDocument();
    await expect.poll(() => orgCalls).toBe(1);

    act(() => {
      for (const id of ["n-access-1", "n-access-2"]) {
        hub.handlers.ReceiveNotification(
          item({
            id,
            title: "Your Access Desk access changed",
            message: "Your place in the organisation changed.",
            relatedEntityType: "User",
            relatedEntityId: "u-1",
          }),
        );
      }
    });

    await expect.poll(() => refreshCalls).toBe(1);
    // Nothing refetches until the new token is in.
    expect(meCalls).toBe(1);
    expect(orgCalls).toBe(1);

    await act(async () => finishRefresh());

    expect(
      await screen.findByText("Roles: Requester, CaseWorker"),
    ).toBeInTheDocument();
    await expect.poll(() => orgCalls).toBeGreaterThan(1);
    expect(refreshCalls).toBe(1);
  });
});

describe("live ticket updates", () => {
  it("an Assignment notification for the open ticket refetches it (and the queue), nothing else", async () => {
    const { queryClient } = renderBell();
    let ticketLoads = 0;
    let queueLoads = 0;
    let availabilityLoads = 0;
    const observe = (queryKey, count) =>
      new QueryObserver(queryClient, {
        queryKey,
        queryFn: async () => {
          count();
          return {};
        },
        staleTime: Infinity,
      }).subscribe(() => {});
    const stops = [
      observe(ticketKeys.ticket({ reference: "CP-2026-000001" }), () => {
        ticketLoads += 1;
      }),
      observe(ticketKeys.list({ view: "assigned", status: 2 }), () => {
        queueLoads += 1;
      }),
      observe(["availability", "me"], () => {
        availabilityLoads += 1;
      }),
    ];
    await waitFor(() => expect(ticketLoads).toBe(1));
    expect(hub.started).toBe(1);

    act(() => {
      hub.handlers.ReceiveNotification(
        item({
          id: "n-9",
          title: "Ticket CP-2026-000001 assigned to you",
          message: "Test Head of Unit passed it to you.",
          type: 3,
          category: 2,
          relatedEntityType: "Ticket",
          relatedEntityId: "t-1",
          deepLinkUrl: "/tickets/CP-2026-000001",
          isActionRequired: true,
        }),
      );
    });

    await waitFor(() => expect(ticketLoads).toBe(2));
    await waitFor(() => expect(queueLoads).toBe(2));
    expect(availabilityLoads).toBe(1);
    stops.forEach((stop) => stop());
  });

  it("a CategorySkills notification refetches What I handle", async () => {
    const { queryClient } = renderBell();
    let loads = 0;
    const stop = new QueryObserver(queryClient, {
      queryKey: MY_CATEGORIES_KEY,
      queryFn: async () => {
        loads += 1;
        return [];
      },
      staleTime: Infinity,
    }).subscribe(() => {});
    await waitFor(() => expect(loads).toBe(1));
    expect(hub.started).toBe(1);

    act(() => {
      hub.handlers.ReceiveNotification(
        item({
          id: "n-10",
          title: "Your categories in Refund changed",
          relatedEntityType: "CategorySkills",
        }),
      );
    });
    await waitFor(() => expect(loads).toBe(2));
    stop();
  });
});

describe("Escalation notifications", () => {
  it("render in the list and open the ticket", async () => {
    const user = userEvent.setup();
    const { router } = renderBell({
      "GET /api/notifications": () => [
        200,
        {
          items: [
            item({
              id: "n-esc",
              title: "Ticket CP-2026-000005 escalated to you",
              message: "Test Case Worker Three needs your help.",
              type: 3,
              category: 4,
              isActionRequired: true,
              relatedEntityType: "Ticket",
              relatedEntityId: "t-5",
              deepLinkUrl: "/tickets/CP-2026-000005",
            }),
          ],
          total: 1,
          unread: 1,
          page: 1,
          pageSize: 10,
        },
      ],
      "PATCH /api/notifications/:id/read": () => [204, ""],
    });
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Ticket CP-2026-000005 escalated to you/,
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tickets/CP-2026-000005"),
    );
  });
});

describe("SLA notifications", () => {
  it.each([
    ["Ticket CP-2026-000011 is nearing its deadline", 1, "CP-2026-000011"],
    ["Ticket CP-2026-000012 is overdue", 4, "CP-2026-000012"],
    ["Ticket CP-2026-000013 is far past its deadline", 4, "CP-2026-000013"],
  ])("%s renders and opens the ticket", async (title, category, reference) => {
    const user = userEvent.setup();
    const { router } = renderBell({
      "GET /api/notifications": () => [
        200,
        {
          items: [
            item({
              id: "n-sla",
              title,
              message: "This Account Reconciliation request needs attention.",
              type: 3,
              category,
              isActionRequired: true,
              relatedEntityType: "Ticket",
              relatedEntityId: "t-x",
              deepLinkUrl: `/tickets/${reference}`,
            }),
          ],
          total: 1,
          unread: 1,
          page: 1,
          pageSize: 10,
        },
      ],
      "PATCH /api/notifications/:id/read": () => [204, ""],
    });
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    await user.click(
      await screen.findByRole("button", { name: new RegExp(title) }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/tickets/${reference}`),
    );
  });
});
