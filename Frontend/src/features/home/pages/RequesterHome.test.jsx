import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import { poolPage } from "@/test/pages";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import HomePage from "./HomePage.jsx";

const CATALOGUE = [
  {
    departmentId: "d-ben",
    code: "BE",
    name: "Benefits",
    categories: [
      {
        id: "c-ref",
        name: "Refund request",
        description: "Money paid back to a member.",
        defaultPriority: 2,
      },
      {
        id: "c-st",
        name: "Statement copy",
        description: "A copy of a member statement.",
        defaultPriority: 1,
      },
      { id: "c-pin", name: "PIN reset", description: null, defaultPriority: 2 },
      {
        id: "c-trf",
        name: "Transfer in",
        description: "Move savings from another fund.",
        defaultPriority: 2,
      },
    ],
  },
  {
    departmentId: "d-it",
    code: "IT",
    name: "Information Technology",
    categories: Array.from({ length: 10 }, (_, i) => ({
      id: `c-it-${i}`,
      name: i === 0 ? "System access" : `IT service ${i}`,
      description: i === 0 ? "Log in to an internal system." : null,
      defaultPriority: 2,
    })),
  },
];

const SUGGESTIONS = {
  recent: [],
  popular: [
    {
      categoryId: "c-ref",
      categoryName: "Refund request",
      description: null,
      departmentId: "d-ben",
      departmentName: "Benefits",
    },
  ],
};

const MINE = {
  open: 0,
  waitingToStart: 0,
  warning: 0,
  overdue: 0,
  farPast: 0,
  raisedOpen: 2,
  toConfirm: 0,
  waitingOnMe: 2,
};

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const person = { userId: "u-1", userName: "amaka.obi", fullName: "Amaka Obi" };
const ticket = (n, overrides = {}) => ({
  id: `t-${n}`,
  reference: `BE-2026-00000${n}`,
  subject: `Request number ${n}`,
  departmentCode: "BE",
  categoryName: "Refund request",
  unitName: "Payments",
  locationName: "HQ",
  priority: 3,
  status: 4,
  requester: person,
  assignee: null,
  assignedAt: null,
  firstRespondedAt: null,
  escalatedToHeadAt: null,
  slaLevel: 0,
  slaDueAt: null,
  createdAt: "2026-11-20T09:00:00Z",
  updatedAt: "2026-11-22T09:00:00Z",
  ...overrides,
});

function renderHome({
  roles = ["Requester"],
  org = { departments: [] },
  routes = {},
} = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/catalogue/categories": () => [200, CATALOGUE],
    "GET /api/catalogue/templates": () => [200, []],
    "GET /api/catalogue/suggestions": () => [200, SUGGESTIONS],
    "GET /api/dashboard/summary": () => [
      200,
      { generatedAt: "2026-11-23T09:00:00Z", mine: MINE, overview: null },
    ],
    "GET /api/tickets": ({ params }) =>
      params.pendingReason === 1
        ? [
            200,
            {
              items: [
                ticket(7, {
                  status: 4,
                  pendingReason: 1,
                  pendingSince: daysAgo(3),
                }),
                ticket(8, {
                  status: 4,
                  pendingReason: 1,
                  pendingSince: daysAgo(1),
                }),
              ],
              total: 2,
              page: 1,
              pageSize: 5,
            },
          ]
        : params.view === "mine" && params.open
          ? [
              200,
              {
                items: [ticket(1), ticket(2, { status: 3, priority: 4 })],
                total: 2,
                page: 1,
                pageSize: 5,
              },
            ]
          : [200, { items: [], total: 0, page: 1, pageSize: 1 }],
    "GET /api/pool": (config) => [200, poolPage([], config.params)],
    "GET /api/availability/me": () => [
      200,
      {
        today: "2026-11-23",
        inStructure: true,
        availableNow: true,
        current: null,
        absences: [],
      },
    ],
    ...routes,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ roles }));
  const view = renderWithProviders(<HomePage />, { queryClient });
  return { ...view, api };
}

describe("Requester Home", () => {
  it("searches name, description and department, highlights the match, and Enter opens the form with the category", async () => {
    const user = userEvent.setup();
    const { router } = renderHome();
    const box = await screen.findByRole("combobox", {
      name: "What do you need help with?",
    });
    await waitFor(() => expect(box).toHaveFocus());
    // No role cards any more.
    expect(screen.queryByText("What you can do")).not.toBeInTheDocument();

    await user.type(box, "paid back");
    let list = screen.getByRole("listbox", { name: "Matching request types" });
    let options = within(list).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Refund request");
    expect(options[0]).toHaveTextContent("Benefits");
    expect(
      within(options[0])
        .getAllByText((_, el) => el.tagName === "MARK")
        .map((m) => m.textContent),
    ).toEqual(["paid", "back"]);

    await user.clear(box);
    await user.type(box, "technology");
    list = screen.getByRole("listbox");
    options = within(list).getAllByRole("option");
    expect(options).toHaveLength(8);
    expect(screen.getByText(/^8 results./)).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-activedescendant", options[0].id);
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(box, "refund");
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/tickets/new");
    expect(router.state.location.search).toBe("?categoryId=c-ref");
  });

  it("with no match, points to the departments and a general request", async () => {
    const user = userEvent.setup();
    renderHome();
    const box = await screen.findByRole("combobox");
    await user.type(box, "zebra");
    expect(
      screen.getByText(/Nothing matches\. Browse the departments below, or/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "raise a general request" }),
    ).toHaveAttribute("href", "/tickets/new");
  });

  it("quick picks: an empty row hides; a chip opens the form with its category", async () => {
    renderHome();
    const popular = await screen.findByTestId("suggestions-popular");
    expect(screen.queryByTestId("suggestions-recent")).not.toBeInTheDocument();
    const chip = within(popular).getByRole("link", {
      name: "Refund request (Benefits)",
    });
    expect(chip).toHaveAttribute("href", "/tickets/new?categoryId=c-ref");
    expect(chip).toHaveAttribute("title", "Benefits");
  });

  it("Needs your attention shows and links only the counts above 0", async () => {
    renderHome();
    const card = await screen.findByTestId("needs-attention");
    expect(within(card).getByTestId("attention-waitingOnMe")).toHaveAttribute(
      "href",
      "/tickets?status=pending-me",
    );
    expect(
      await within(card).findByText("You have 2 requests waiting on you"),
    ).toBeInTheDocument();
    expect(within(card).queryByTestId("attention-toConfirm")).toBeNull();
  });

  it("asks the server for 5 requests waiting on me, longest waiting first, shows them as they come and the true total", async () => {
    const asked = [];
    renderHome({
      routes: {
        "GET /api/tickets": ({ params }) => {
          asked.push(params);
          if (params.pendingReason === 1)
            return [
              200,
              {
                // The server's order (longest waiting first) and its total of 7.
                items: [
                  ticket(3, {
                    status: 4,
                    pendingReason: 1,
                    pendingSince: daysAgo(11),
                  }),
                  ticket(4, {
                    status: 4,
                    pendingReason: 1,
                    pendingSince: daysAgo(6),
                  }),
                  ticket(1, {
                    status: 4,
                    pendingReason: 1,
                    pendingSince: daysAgo(1),
                  }),
                ],
                total: 7,
                page: 1,
                pageSize: 5,
              },
            ];
          return [200, { items: [], total: 0, page: 1, pageSize: 5 }];
        },
      },
    });
    const list = await screen.findByTestId("waiting-on-me");
    expect(list).toHaveAccessibleName(
      "Waiting for your reply, longest waiting first",
    );
    const rows = within(list).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/tickets/BE-2026-000003",
      "/tickets/BE-2026-000004",
      "/tickets/BE-2026-000001",
    ]);
    expect(
      rows.map((r) => within(r).getByTestId("pending-wait").textContent),
    ).toEqual([
      "Waiting on you · 11d",
      "Waiting on you · 6d",
      "Waiting on you · 1d",
    ]);
    // The total is the server's (7), not the summary's or the rows'.
    const card = screen.getByTestId("needs-attention");
    expect(card).toHaveTextContent("You have 7 requests waiting on you");
    expect(within(card).getByTestId("attention-waitingOnMe")).toHaveAttribute(
      "href",
      "/tickets?status=pending-me",
    );
    expect(asked.find((p) => p.pendingReason === 1)).toEqual({
      view: "mine",
      pendingReason: 1,
      sort: "pendingsince",
      page: 1,
      pageSize: 5,
    });
  });

  it("hides Needs your attention when both counts are 0", async () => {
    renderHome({
      routes: {
        "GET /api/dashboard/summary": () => [
          200,
          {
            generatedAt: "2026-11-23T09:00:00Z",
            mine: { ...MINE, waitingOnMe: 0, toConfirm: 0 },
            overview: null,
          },
        ],
      },
    });
    await screen.findByTestId("my-requests");
    await screen.findByText("Request number 1");
    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("lists my latest open requests with status, priority and when updated", async () => {
    renderHome();
    const strip = await screen.findByTestId("my-requests");
    const link = await within(strip).findByRole("link", {
      name: /Request number 1/,
    });
    expect(link).toHaveAttribute("href", "/tickets/BE-2026-000001");
    expect(link).toHaveTextContent("BE-2026-000001");
    expect(link).toHaveTextContent("Pending");
    expect(link).toHaveTextContent("High");
    expect(link).toHaveTextContent(/Updated .* ago/);
    expect(
      within(strip).getByRole("link", { name: "See all my requests" }),
    ).toHaveAttribute("href", "/tickets");
  });

  it("tells someone who never raised a request how to start", async () => {
    renderHome({
      routes: {
        "GET /api/tickets": () => [
          200,
          { items: [], total: 0, page: 1, pageSize: 5 },
        ],
      },
    });
    expect(await screen.findByTestId("my-requests-empty")).toHaveTextContent(
      "You have not raised a request yet. Search above to get started.",
    );
  });

  it("a department card opens its request types with Raise; a long list gets a filter", async () => {
    const user = userEvent.setup();
    renderHome();
    const it = await screen.findByRole("button", {
      name: /Information Technology/,
    });
    expect(it).toHaveTextContent("10 request types");
    expect(it).toHaveTextContent("System access · IT service 1 · IT service 2");
    await user.click(it);
    expect(it).toHaveAttribute("aria-expanded", "true");
    const types = screen.getByTestId("types-d-it");
    await user.type(
      within(types).getByLabelText(
        "Filter Information Technology request types",
      ),
      "access",
    );
    const raise = within(types).getAllByRole("link", { name: /^Raise / });
    expect(raise).toHaveLength(1);
    expect(raise[0]).toHaveAttribute("href", "/tickets/new?categoryId=c-it-0");

    // Four types: no filter.
    await user.click(screen.getByRole("button", { name: /Benefits/ }));
    expect(
      within(screen.getByTestId("types-d-ben")).queryByRole("searchbox"),
    ).not.toBeInTheDocument();
  });

  it("says when nothing can be requested yet (Super Admin gets a link to set it up)", async () => {
    renderHome({
      roles: ["Requester", "SuperAdmin"],
      org: { departments: [] },
      routes: {
        "GET /api/catalogue/categories": () => [200, []],
        "GET /api/admin/categories/cover-warnings": () => [200, []],
      },
    });
    // A Super Admin oversees, so their home is the overview; the requester view is checked below.
    await screen.findByTestId("staff-request-row");

    renderHome({
      routes: { "GET /api/catalogue/categories": () => [200, []] },
    });
    const empty = await screen.findByTestId("no-services");
    expect(empty).toHaveTextContent(
      "No services are available to request yet.",
    );
    expect(within(empty).queryByRole("link")).toBeNull();
  });

  it("one failing call leaves the rest of the page: the departments offer Try again", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderHome({
      routes: {
        "GET /api/catalogue/categories": () =>
          fail ? [500, { message: "Down." }] : [200, CATALOGUE],
      },
    });
    const error = await screen.findByTestId("departments-error");
    expect(error).toHaveTextContent("The departments could not be loaded.");
    // Everything else is there.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(await screen.findByText("Request number 1")).toBeInTheDocument();
    expect(await screen.findByTestId("needs-attention")).toBeInTheDocument();
    expect(
      await screen.findByTestId("suggestions-popular"),
    ).toBeInTheDocument();

    fail = false;
    await user.click(within(error).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: /Benefits/ }),
    ).toBeInTheDocument();
  });
});

describe("Staff homes", () => {
  const CASE_WORKER_ORG = {
    departments: [
      {
        id: "d-cp",
        code: "CP",
        name: "Contribution Processing",
        isHod: false,
        isAdmin: false,
        units: [
          {
            id: "u-rf",
            code: "RF",
            name: "Refund",
            isHead: false,
            isMember: true,
          },
        ],
      },
    ],
  };

  it("a case worker keeps their unit home and gets the compact request row (no autofocus)", async () => {
    const user = userEvent.setup();
    const { router } = renderHome({
      roles: ["Requester", "CaseWorker"],
      org: CASE_WORKER_ORG,
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Refund" }),
    ).toBeInTheDocument();
    const row = await screen.findByTestId("staff-request-row");
    await waitFor(() =>
      expect(within(row).getByTestId("staff-raisedOpen")).toHaveTextContent(
        "2 open requests",
      ),
    );
    expect(within(row).getByTestId("staff-raisedOpen")).toHaveAttribute(
      "href",
      "/tickets?status=open",
    );
    expect(within(row).getByTestId("staff-waitingOnMe")).toHaveAttribute(
      "href",
      "/tickets?status=4",
    );
    expect(within(row).getByTestId("staff-toConfirm")).toHaveAttribute(
      "href",
      "/tickets?status=5",
    );
    // Not the departments or the full list: those are the requester home's.
    expect(screen.queryByText("Browse by department")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-requests")).not.toBeInTheDocument();

    const box = within(row).getByRole("combobox", {
      name: "What do you need help with?",
    });
    expect(box).not.toHaveFocus();
    await user.type(box, "statement");
    await user.keyboard("{Enter}");
    expect(router.state.location.search).toBe("?categoryId=c-st");
  });
});
