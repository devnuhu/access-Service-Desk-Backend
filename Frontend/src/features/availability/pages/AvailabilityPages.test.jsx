import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import MyAvailabilityPage from "./MyAvailabilityPage.jsx";
import { UnitAvailabilityPage } from "./TeamAvailabilityPages.jsx";

const TODAY = "2026-11-03";

const absence = (overrides) => ({
  id: "a-1",
  userId: "u-1",
  kind: 1,
  startDate: "2026-11-02",
  endDate: "2026-11-05",
  note: null,
  recordedBy: "Amaka Obi",
  recordedAt: "2026-11-02T08:00:00Z",
  ...overrides,
});

function renderMine(availability, extraRoutes = {}) {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/availability/me": () => [200, availability],
    ...extraRoutes,
  });
  renderWithProviders(<MyAvailabilityPage />, { queryClient });
  return api;
}

const mine = (overrides) => ({
  today: TODAY,
  inStructure: true,
  availableNow: true,
  current: null,
  absences: [],
  ...overrides,
});

describe("My availability", () => {
  it("explains the page to people outside the structure, and nothing else", async () => {
    renderMine(mine({ inStructure: false }));
    expect(
      await screen.findByText(
        "Leave is recorded here for people who work in a unit or head a department.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Record leave" })).toBeNull();
  });

  it('shows "Out of office until …" when current has kind 2', async () => {
    const current = absence({ kind: 2, endDate: "2026-11-05" });
    renderMine(mine({ availableNow: false, current, absences: [current] }));
    expect(
      await screen.findByText("Out of office until Thu 5 Nov 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You will not be given new tickets while away."),
    ).toBeInTheDocument();
  });

  it("shows End early for a started period and Cancel for a future one", async () => {
    const started = absence({ id: "a-now" });
    const future = absence({
      id: "a-later",
      startDate: "2026-11-09",
      endDate: "2026-11-13",
      note: "Annual leave",
    });
    renderMine(
      mine({
        availableNow: false,
        current: started,
        absences: [started, future],
      }),
    );
    const list = await screen.findByRole("list", { name: "Leave periods" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(
      within(first).getByRole("button", { name: "End early" }),
    ).toBeInTheDocument();
    expect(
      within(second).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(second).toHaveTextContent("Mon 9 Nov – Fri 13 Nov 2026 (5 days)");
    expect(second).toHaveTextContent("Recorded by Amaka Obi");

    await userEvent.click(
      within(first).getByRole("button", { name: "End early" }),
    );
    expect(
      await screen.findByText("You will be available from today."),
    ).toBeInTheDocument();
  });

  it("puts a field error from errors.endDate under End, and the message above the form", async () => {
    let sent;
    renderMine(mine(), {
      "POST /api/availability/absences": ({ body }) => {
        sent = body;
        return [
          400,
          {
            message: "The end date must be on or after the start date.",
            errors: { endDate: "Must be after the 2026 holiday freeze." },
          },
        ];
      },
    });
    const form = await screen.findByRole("form", { name: "Record leave" });
    await userEvent.click(within(form).getByLabelText("Out of office"));
    await userEvent.click(within(form).getByRole("button", { name: "Record" }));

    const end = within(form).getByLabelText("End");
    expect(
      await within(form).findByText("Must be after the 2026 holiday freeze."),
    ).toBeInTheDocument();
    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "The end date must be on or after the start date.",
    );
    expect(sent).toEqual({ kind: 2, startDate: TODAY, endDate: TODAY });
  });

  it("shows a 409 overlap message above the form", async () => {
    renderMine(mine(), {
      "POST /api/availability/absences": () => [
        409,
        { message: "This overlaps leave from 2 Nov to 5 Nov.", errors: {} },
      ],
    });
    const form = await screen.findByRole("form", { name: "Record leave" });
    await userEvent.click(within(form).getByRole("button", { name: "Record" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "This overlaps leave from 2 Nov to 5 Nov.",
    );
  });
});

const member = (overrides) => ({
  userId: "u-cw1",
  userName: "test.caseworker1",
  fullName: "Test Caseworker1",
  staffCategory: 1,
  isHead: false,
  isDeputy: false,
  accountActive: true,
  availableNow: true,
  current: null,
  upcoming: [],
  ...overrides,
});

describe("Unit availability", () => {
  it('shows "1 of 2 available today" in orange, and Record leave posts userId', async () => {
    let sent;
    const queryClient = createTestQueryClient();
    installFakeApi(queryClient, {
      "GET /api/availability/units/:unitId": () => [
        200,
        {
          unitId: "u-cm",
          departmentId: "d-cp",
          code: "CM",
          name: "Contribution Matching",
          today: TODAY,
          memberCount: 2,
          availableCount: 1,
          members: [
            member({
              userId: "u-hou",
              userName: "test.hou",
              fullName: "Test HOU",
              staffCategory: 2,
              isHead: true,
              upcoming: [
                absence({
                  id: "x1",
                  startDate: "2026-11-09",
                  endDate: "2026-11-13",
                }),
                absence({
                  id: "x2",
                  startDate: "2026-11-20",
                  endDate: "2026-11-20",
                }),
                absence({
                  id: "x3",
                  startDate: "2026-11-30",
                  endDate: "2026-12-02",
                }),
              ],
            }),
            member({
              availableNow: false,
              current: absence({ userId: "u-cw1", endDate: "2026-11-05" }),
            }),
          ],
        },
      ],
      "POST /api/availability/absences": ({ body }) => {
        sent = body;
        return [200, absence({ id: "new", userId: body.userId })];
      },
    });
    renderWithProviders(
      <Routes>
        <Route
          path="/availability/units/:unitId"
          element={<UnitAvailabilityPage />}
        />
      </Routes>,
      { route: "/availability/units/u-cm", queryClient },
    );

    const count = await screen.findByTestId("available-count");
    expect(count).toHaveTextContent("1 of 2 available today");
    expect(count).toHaveClass("text-brand-orange-ink");
    expect(count).toHaveTextContent(
      "Tickets may wait for an available case worker.",
    );

    const cw1 = screen.getByText("Test Caseworker1").closest("tr");
    expect(within(cw1).getByText("On leave until 5 Nov")).toBeInTheDocument();
    const hou = screen.getByText("Test HOU").closest("tr");
    expect(within(hou).getByText("Available")).toBeInTheDocument();
    expect(hou).toHaveTextContent("9–13 Nov, 20 Nov +1 more");

    await userEvent.click(
      within(cw1).getByRole("button", {
        name: "Record leave for Test Caseworker1",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Leave for Test Caseworker1",
    });
    expect(
      within(dialog).getByRole("button", { name: "End early" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record" }),
    );
    await expect.poll(() => sent).toBeDefined();
    expect(sent).toEqual({
      userId: "u-cw1",
      kind: 1,
      startDate: TODAY,
      endDate: TODAY,
    });
  });

  it("shows the API's 403 message", async () => {
    const queryClient = createTestQueryClient();
    installFakeApi(queryClient, {
      "GET /api/availability/units/:unitId": () => [
        403,
        {
          message: "Only the head, deputy or HOD can see this unit.",
          errors: {},
        },
      ],
    });
    renderWithProviders(
      <Routes>
        <Route
          path="/availability/units/:unitId"
          element={<UnitAvailabilityPage />}
        />
      </Routes>,
      { route: "/availability/units/u-rf", queryClient },
    );
    expect(
      await screen.findByText(
        "Only the head, deputy or HOD can see this unit.",
      ),
    ).toBeInTheDocument();
  });
});
