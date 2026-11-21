import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import MyUnitPage from "./MyUnitPage.jsx";

const DASHBOARD = {
  generatedAt: "2026-11-21T09:05:00Z",
  unitId: "u-cm",
  unitName: "Contribution Matching",
  departmentId: "d-cp",
  departmentName: "Contribution Processing",
  counts: {
    open: 0,
    waitingToStart: 0,
    unassigned: 0,
    warning: 0,
    overdue: 0,
    farPast: 0,
    escalated: 0,
  },
  pool: [],
  team: [],
  categories: [],
  escalated: [],
  attention: [],
};

const CATEGORIES = [
  {
    id: "c-1",
    name: "Unmatched contribution",
    description: "Money received with no schedule.",
    timelineHours: 24,
    defaultPriority: 2,
    sortOrder: 1,
    isActive: true,
    eligibleCount: 1,
    needsCover: true,
  },
  {
    id: "c-2",
    name: "Employer code correction",
    description: null,
    timelineHours: 48,
    defaultPriority: 3,
    sortOrder: 2,
    isActive: true,
    eligibleCount: 2,
    needsCover: false,
  },
];

const skills = (chidi = ["c-2"]) => ({
  unitId: "u-cm",
  unitName: "Contribution Matching",
  categories: CATEGORIES.map(({ id, name, isActive, eligibleCount }) => ({
    id,
    name,
    isActive,
    eligibleCount,
  })),
  members: [
    {
      userId: "p-1",
      userName: "test.hou",
      fullName: "Hope Head",
      staffCategory: 2,
      accountActive: true,
      categoryIds: ["c-1", "c-2"],
    },
    {
      userId: "p-2",
      userName: "test.caseworker1",
      fullName: "Chidi One",
      staffCategory: 1,
      accountActive: true,
      categoryIds: chidi,
    },
  ],
  warnings: [
    {
      categoryId: "c-1",
      categoryName: "Unmatched contribution",
      unitId: "u-cm",
      unitName: "Contribution Matching",
      eligibleCount: 1,
    },
  ],
});

const headOrg = {
  departments: [
    {
      id: "d-cp",
      code: "CP",
      name: "Contribution Processing",
      isHod: false,
      isAdmin: false,
      units: [
        {
          id: "u-cm",
          code: "CM",
          name: "Contribution Matching",
          isHead: true,
          isMember: true,
        },
      ],
    },
  ],
};
const hodOrg = {
  departments: [
    {
      id: "d-cp",
      code: "CP",
      name: "Contribution Processing",
      isHod: true,
      isAdmin: false,
      units: [],
    },
  ],
};

function renderUnit({ org = headOrg, roles, routes = {}, tab = "" } = {}) {
  const queryClient = createTestQueryClient();
  const sent = [];
  let current = skills();
  installFakeApi(queryClient, {
    "GET /api/org/me": () => [200, org],
    "GET /api/dashboard/unit/:unitId": () => [200, DASHBOARD],
    "GET /api/units/:unitId/canned-replies": () => [200, []],
    "GET /api/canned-replies/placeholders": () => [200, []],
    "GET /api/units/:unitId/categories": () => [200, CATEGORIES],
    "GET /api/units/:unitId/skills": () => [200, current],
    "GET /api/availability/units/:unitId": () => [
      200,
      {
        unitId: "u-cm",
        departmentId: "d-cp",
        code: "CM",
        name: "Contribution Matching",
        today: "2026-11-21",
        memberCount: 2,
        availableCount: 1,
        members: [
          {
            userId: "p-2",
            userName: "test.caseworker1",
            fullName: "Chidi One",
            staffCategory: 1,
            isHead: false,
            accountActive: true,
            availableNow: false,
            current: {
              id: "a-1",
              userId: "p-2",
              kind: 1,
              startDate: "2026-11-20",
              endDate: "2026-11-24",
              note: null,
              recordedBy: null,
              recordedAt: "2026-11-19T09:00:00Z",
            },
            upcoming: [],
          },
        ],
      },
    ],
    "PUT /api/units/:unitId/skills/:userId": (config) => {
      sent.push([config.pathParams.userId, config.body]);
      current = skills(config.body.categoryIds);
      return [
        200,
        {
          message:
            "Chidi One now handles 2 categories of Contribution Matching.",
        },
      ];
    },
    ...routes,
  });
  queryClient.setQueryData(
    SESSION_KEY,
    makeUser({ roles: roles ?? ["Requester", "CaseWorker", "HeadOfUnit"] }),
  );
  renderWithProviders(
    <Routes>
      <Route path="/units/:unitId" element={<MyUnitPage />} />
    </Routes>,
    { route: `/units/u-cm${tab}`, queryClient },
  );
  return sent;
}

const tabNames = () =>
  screen.getAllByRole("tab").map((tab) => tab.textContent.replace(/\d+$/, ""));

describe("My unit (head)", () => {
  it("shows the unit with its department and every tab, Overview first", async () => {
    renderUnit();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Contribution Matching",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Contribution Processing")).toBeInTheDocument();
    await waitFor(() =>
      expect(tabNames()).toEqual([
        "Overview",
        "Categories",
        "Team and skills",
        "Replies",
        "Availability",
      ]),
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
  });

  it("Categories is read only: timeline, priority, people, Needs cover, and who handles a row", async () => {
    const user = userEvent.setup();
    renderUnit({ tab: "?tab=categories" });
    const row = await screen.findByTestId("category-Unmatched contribution");
    expect(row).toHaveTextContent("24 h");
    expect(row).toHaveTextContent("Medium");
    expect(row).toHaveTextContent("1 person");
    expect(within(row).getByText("Needs cover")).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("category-Employer code correction"),
      ).queryByText("Needs cover"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Categories are set by the Super Admin/),
    ).toBeInTheDocument();

    await user.click(
      within(row).getByRole("button", { name: /Unmatched contribution/ }),
    );
    const who = await screen.findByRole("list", {
      name: "Who handles Unmatched contribution",
    });
    expect(within(who).getByText("Hope Head")).toBeInTheDocument();
    expect(within(who).queryByText("Chidi One")).not.toBeInTheDocument();
  });

  it("a tick saves that member's whole set at once and shows the server's message", async () => {
    const user = userEvent.setup();
    const sent = renderUnit({ tab: "?tab=team" });
    expect(await screen.findByTestId("cover-banner")).toBeInTheDocument();
    // Who is away comes from the unit's availability.
    expect(
      await screen.findByText("On leave until 24 Nov"),
    ).toBeInTheDocument();
    const cell = screen.getByRole("checkbox", {
      name: "Unmatched contribution for Chidi One",
    });
    expect(cell).not.toBeChecked();
    await user.click(cell);
    // Optimistic: ticked straight away.
    expect(cell).toBeChecked();
    await waitFor(() =>
      expect(sent).toEqual([["p-2", { categoryIds: ["c-2", "c-1"] }]]),
    );
    expect(
      await screen.findByText(
        "Chidi One now handles 2 categories of Contribution Matching.",
      ),
    ).toBeInTheDocument();
  });

  it("puts the tick back when the server refuses", async () => {
    const user = userEvent.setup();
    renderUnit({
      tab: "?tab=team",
      routes: {
        "PUT /api/units/:unitId/skills/:userId": () => [
          400,
          { message: "Chidi One is blocked." },
        ],
      },
    });
    const cell = await screen.findByRole("checkbox", {
      name: "Unmatched contribution for Chidi One",
    });
    await user.click(cell);
    expect(
      await screen.findByText("Chidi One is blocked."),
    ).toBeInTheDocument();
    await waitFor(() => expect(cell).not.toBeChecked());
  });
});

describe("My unit (HOD)", () => {
  it("reads only: no Replies tab, the matrix cannot change", async () => {
    const user = userEvent.setup();
    renderUnit({
      org: hodOrg,
      roles: ["Requester", "HOD"],
      routes: {
        "GET /api/units/:unitId/canned-replies": () => [
          403,
          { message: "Not allowed." },
        ],
      },
    });
    await screen.findByRole("heading", {
      level: 1,
      name: "Contribution Matching",
    });
    await waitFor(() =>
      expect(tabNames()).toEqual([
        "Overview",
        "Categories",
        "Team and skills",
        "Availability",
      ]),
    );
    await user.click(screen.getByRole("tab", { name: "Team and skills" }));
    const cell = await screen.findByRole("checkbox", {
      name: "Unmatched contribution for Chidi One",
    });
    expect(cell).toBeDisabled();
    expect(
      screen.getByText(
        "You can see who handles what. The head of the unit changes it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Tick every category/ }),
    ).not.toBeInTheDocument();
  });
});

describe("My unit (anyone else)", () => {
  it("a 403 shows a plain not-allowed page", async () => {
    renderUnit({
      routes: {
        "GET /api/dashboard/unit/:unitId": () => [
          403,
          { message: "Only the head of this unit…" },
        ],
      },
    });
    expect(
      await screen.findByRole("heading", {
        name: "You are not allowed to see this",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
