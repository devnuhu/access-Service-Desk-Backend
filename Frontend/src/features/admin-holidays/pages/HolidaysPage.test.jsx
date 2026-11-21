import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { RequireRole, SESSION_KEY } from "@/features/auth";
import { buildNavigation } from "@/layouts/navigation.js";
import { ROLES } from "@/shared/lib/roles";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import { formatHolidayDate } from "../dates.js";
import HolidaysPage from "./HolidaysPage.jsx";

const YEAR = new Date().getFullYear();
const NEXT = YEAR + 1;

function renderHolidays() {
  const queryClient = createTestQueryClient();
  let holidays = [
    {
      id: null,
      date: `${YEAR}-01-01`,
      name: "Set in the server settings",
      fromConfig: true,
    },
    {
      id: "h-1",
      date: `${YEAR}-10-01`,
      name: "Independence Day",
      fromConfig: false,
    },
    {
      id: "h-2",
      date: `${NEXT}-12-25`,
      name: "Christmas Day",
      fromConfig: false,
    },
  ];
  const calls = { years: [], posted: [], deleted: [] };
  installFakeApi(queryClient, {
    "GET /api/admin/holidays": ({ params }) => {
      calls.years.push(Number(params.year));
      return [
        200,
        holidays.filter((h) => h.date.startsWith(String(params.year))),
      ];
    },
    "POST /api/admin/holidays": ({ body }) => {
      calls.posted.push(body);
      if (holidays.some((h) => h.date === body.date))
        return [409, { message: `${body.date} is already a holiday.` }];
      const created = { id: "h-new", ...body, fromConfig: false };
      holidays = [...holidays, created].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      return [200, created];
    },
    "DELETE /api/admin/holidays/:holidayId": ({ pathParams }) => {
      calls.deleted.push(pathParams.holidayId);
      holidays = holidays.filter((h) => h.id !== pathParams.holidayId);
      return [
        200,
        { message: "Holiday removed. Deadlines count that day again." },
      ];
    },
  });
  renderWithProviders(<HolidaysPage />, { queryClient });
  return calls;
}

/** Types a yyyy-MM-dd value into the native date input. */
async function chooseDate(user, input, value) {
  await user.clear(input);
  await user.type(input, value);
}

describe("formatHolidayDate", () => {
  it("shows the weekday without moving the day", () => {
    expect(formatHolidayDate("2027-01-01")).toBe("Fri 1 Jan 2027");
    expect(formatHolidayDate("2026-12-25")).toBe("Fri 25 Dec 2026");
  });
});

describe("Holidays", () => {
  it("lists this year's holidays and switches year", async () => {
    const user = userEvent.setup();
    const calls = renderHolidays();
    const independence = await screen.findByTestId(`holiday-${YEAR}-10-01`);
    expect(independence).toHaveTextContent(formatHolidayDate(`${YEAR}-10-01`));
    expect(within(independence).getByText("Added here")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`holiday-${NEXT}-12-25`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The SLA clock does not run on these days or on weekends. Tickets keep their raised date; only deadlines move.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: String(NEXT) }));
    expect(
      await screen.findByTestId(`holiday-${NEXT}-12-25`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`holiday-${YEAR}-10-01`),
    ).not.toBeInTheDocument();
    expect(calls.years).toEqual([YEAR, NEXT]);

    // A year with none says so.
    await user.click(screen.getByRole("button", { name: String(YEAR - 1) }));
    expect(
      await screen.findByText(`No holidays in ${YEAR - 1}`),
    ).toBeInTheDocument();
  });

  it("a server-settings holiday is read-only: no Remove", async () => {
    renderHolidays();
    const fixed = await screen.findByTestId(`holiday-${YEAR}-01-01`);
    expect(within(fixed).getByText("Server settings")).toBeInTheDocument();
    expect(
      within(fixed).getByText("Set in the server settings"),
    ).toBeInTheDocument();
    expect(within(fixed).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId(`holiday-${YEAR}-10-01`)).getByRole("button", {
        name: /Remove/,
      }),
    ).toBeInTheDocument();
  });

  it("adds a holiday and refreshes the list", async () => {
    const user = userEvent.setup();
    const calls = renderHolidays();
    await screen.findByTestId(`holiday-${YEAR}-10-01`);
    await user.click(screen.getByRole("button", { name: "Add holiday" }));
    const dialog = await screen.findByRole("dialog", { name: "Add holiday" });
    await chooseDate(
      user,
      within(dialog).getByLabelText("Date"),
      `${YEAR}-06-12`,
    );
    await user.type(within(dialog).getByLabelText("Name"), "Democracy Day");
    await user.click(
      within(dialog).getByRole("button", { name: "Add holiday" }),
    );
    expect(calls.posted).toEqual([
      { date: `${YEAR}-06-12`, name: "Democracy Day" },
    ]);
    expect(
      await screen.findByTestId(`holiday-${YEAR}-06-12`),
    ).toHaveTextContent("Democracy Day");
    expect(screen.getByText("Democracy Day added")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add holiday" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows the server's message when the date is already a holiday (409)", async () => {
    const user = userEvent.setup();
    renderHolidays();
    await screen.findByTestId(`holiday-${YEAR}-10-01`);
    await user.click(screen.getByRole("button", { name: "Add holiday" }));
    const dialog = await screen.findByRole("dialog", { name: "Add holiday" });
    await chooseDate(
      user,
      within(dialog).getByLabelText("Date"),
      `${YEAR}-10-01`,
    );
    await user.type(within(dialog).getByLabelText("Name"), "National Day");
    await user.click(
      within(dialog).getByRole("button", { name: "Add holiday" }),
    );
    expect(
      await within(dialog).findByText(`${YEAR}-10-01 is already a holiday.`),
    ).toBeInTheDocument();
  });

  it("removes a holiday after confirming", async () => {
    const user = userEvent.setup();
    const calls = renderHolidays();
    const row = await screen.findByTestId(`holiday-${YEAR}-10-01`);
    await user.click(within(row).getByRole("button", { name: /Remove/ }));
    const confirm = await screen.findByRole("dialog");
    expect(
      within(confirm).getByText("Deadlines will count this day again."),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    expect(calls.deleted).toEqual(["h-1"]);
    await waitFor(() =>
      expect(
        screen.queryByTestId(`holiday-${YEAR}-10-01`),
      ).not.toBeInTheDocument(),
    );
  });

  it("is for Super Admin only: others get the no-access page and no menu item", async () => {
    const queryClient = createTestQueryClient();
    let asked = false;
    installFakeApi(queryClient, {
      "GET /api/admin/holidays": () => {
        asked = true;
        return [200, []];
      },
    });
    queryClient.setQueryData(
      SESSION_KEY,
      makeUser({ roles: ["Requester", "HOD"] }),
    );
    // The same guard AppRoutes puts around the Administration pages.
    renderWithProviders(
      <Routes>
        <Route path="/no-access" element={<p>No access page</p>} />
        <Route element={<RequireRole roles={[ROLES.SuperAdmin]} />}>
          <Route path="/admin/holidays" element={<HolidaysPage />} />
        </Route>
      </Routes>,
      { route: "/admin/holidays", queryClient },
    );
    expect(await screen.findByText("No access page")).toBeInTheDocument();
    expect(asked).toBe(false);

    const links = (roles) =>
      buildNavigation(makeUser({ roles }), { departments: [] })
        .flatMap((section) => section.items)
        .map((item) => item.label);
    expect(links(["Requester", "HOD"])).not.toContain("Holidays");
    const admin = links(["Requester", "SuperAdmin"]);
    expect(admin.indexOf("Holidays")).toBe(admin.indexOf("Locations") + 1);
  });
});
