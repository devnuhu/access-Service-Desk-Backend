import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { SESSION_KEY } from "@/features/auth";
import { setCsrfToken } from "@/shared/lib/http";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import { draftKey } from "../ticketText.js";
import NewTicketPage from "./NewTicketPage.jsx";

const CATALOGUE = [
  {
    departmentId: "d-cp",
    code: "CP",
    name: "Contribution Processing",
    categories: [
      {
        id: "c-ar",
        name: "Account Reconciliation",
        description: "Balances that do not agree.",
        defaultPriority: 3,
      },
      {
        id: "c-uc",
        name: "Unmatched contribution",
        description: null,
        defaultPriority: 2,
      },
    ],
  },
];

const LOCATIONS = {
  locations: [
    { id: "l-hq", name: "HQ", sortOrder: 1, isActive: true },
    { id: "l-abj", name: "Abuja", sortOrder: 2, isActive: true },
  ],
  defaultLocationId: "l-abj",
};

const twoDaysAgo = new Date(Date.now() - 2.2 * 24 * 3600 * 1000).toISOString();

function renderForm({ roles = ["Requester"], draft, routes = {} } = {}) {
  const user = makeUser({ roles });
  if (draft) {
    window.sessionStorage.setItem(draftKey(user.id), JSON.stringify(draft));
  }
  const queryClient = createTestQueryClient();
  const calls = { create: [], duplicates: [] };
  const api = installFakeApi(queryClient, {
    "GET /api/catalogue/categories": () => [200, CATALOGUE],
    "GET /api/locations": () => [200, LOCATIONS],
    "POST /api/tickets/duplicate-check": (config) => {
      calls.duplicates.push(config.body);
      return [200, { pinsFound: [], matches: [] }];
    },
    "POST /api/tickets": (config) => {
      calls.create.push(config);
      return [
        200,
        { id: "t-1", reference: "CP-2026-000123", message: "Raised." },
      ];
    },
    ...Object.fromEntries(
      Object.entries(routes).map(([key, handler]) => [
        key,
        (config) => {
          if (key === "POST /api/tickets") calls.create.push(config);
          if (key === "POST /api/tickets/duplicate-check")
            calls.duplicates.push(config.body);
          return handler(config);
        },
      ]),
    ),
  });
  queryClient.setQueryData(SESSION_KEY, user);
  const view = renderWithProviders(
    <Routes>
      <Route path="/tickets/new" element={<NewTicketPage />} />
      <Route path="/tickets/:reference" element={<p>Ticket page</p>} />
    </Routes>,
    { route: "/tickets/new", queryClient },
  );
  return { ...view, api, calls, user };
}

const chooseCategory = async (user, name) => {
  await user.click(await screen.findByRole("combobox", { name: "Category" }));
  await user.click(await screen.findByRole("option", { name }));
};

afterEach(() => {
  window.sessionStorage.clear();
  setCsrfToken(null);
});

describe("Raise a ticket", () => {
  it("sets the category's default priority until the user picks one; pre-selects the location; an empty description blocks submit", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm();

    // One department today: no Department select.
    await screen.findByRole("combobox", { name: "Category" });
    expect(screen.queryByLabelText("Department")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("Medium");

    await chooseCategory(user, "Account Reconciliation");
    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("High");
    expect(screen.getByText("Balances that do not agree.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Priority"), "Low");
    await chooseCategory(user, "Unmatched contribution");
    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("Low");

    await user.type(screen.getByLabelText("Subject"), "Balance wrong");
    await screen.findByRole("toolbar", { name: "Formatting" });
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    expect(
      await screen.findByText("Describe the request."),
    ).toBeInTheDocument();
    expect(document.getElementById("ticket-description")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls.create).toHaveLength(0);
  });

  it("sends multipart/form-data with repeated ccUserIds and files and the CSRF header; a 400 on files shows under the picker and keeps the typing", async () => {
    const user = userEvent.setup();
    setCsrfToken("csrf-1");
    let answer = [
      400,
      {
        message: "Some details are not valid.",
        errors: { files: "Statement.pdf is not a real PDF file." },
      },
    ];
    const { calls } = renderForm({
      roles: ["Requester", "SuperAdmin"],
      draft: {
        categoryId: "c-ar",
        subject: "Contribution not on statement",
        descriptionHtml: "<p>Please <strong>check</strong> this.</p>",
        cc: [
          { id: "u-a", fullName: "Ada Eze", userName: "ada.eze" },
          { id: "u-b", fullName: "Bola Ade", userName: "bola.ade" },
        ],
      },
      routes: { "POST /api/tickets": () => answer },
    });

    // The draft came back.
    expect(await screen.findByLabelText("Subject")).toHaveValue(
      "Contribution not on statement",
    );
    expect(screen.getByText("Ada Eze")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await screen.findByRole("toolbar", { name: "Formatting" });

    const pdf = new File([new Uint8Array(2000)], "Statement.pdf", {
      type: "application/pdf",
    });
    const png = new File([new Uint8Array(3000)], "Screen.png", {
      type: "image/png",
    });
    await user.upload(document.getElementById("ticket-files"), [pdf, png]);
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));

    await waitFor(() => expect(calls.create).toHaveLength(1));
    const config = calls.create[0];
    expect(config.body).toBeInstanceOf(FormData);
    expect(config.headers.get("X-CSRF-Token")).toBe("csrf-1");
    const form = config.body;
    expect(form.get("categoryId")).toBe("c-ar");
    expect(form.get("locationId")).toBe("l-abj");
    expect(form.get("priority")).toBe("3");
    expect(form.get("subject")).toBe("Contribution not on statement");
    expect(form.get("descriptionHtml")).toBe(
      "<p>Please <strong>check</strong> this.</p>",
    );
    expect(form.getAll("ccUserIds")).toEqual(["u-a", "u-b"]);
    expect(form.getAll("files").map((file) => file.name)).toEqual([
      "Statement.pdf",
      "Screen.png",
    ]);
    expect(form.has("requesterUserId")).toBe(false);

    expect(
      await screen.findByText("Statement.pdf is not a real PDF file."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue(
      "Contribution not on statement",
    );
    const chosen = screen.getByRole("list", { name: "Chosen files" });
    expect(within(chosen).getByText("Statement.pdf")).toBeInTheDocument();
    expect(within(chosen).getByText("Screen.png")).toBeInTheDocument();

    // Fixed: it goes through, lands on the ticket and clears the draft.
    answer = [
      200,
      { id: "t-1", reference: "CP-2026-000123", message: "Raised." },
    ];
    await user.click(
      within(chosen).getByRole("button", { name: "Remove Statement.pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    expect(await screen.findByText("Ticket page")).toBeInTheDocument();
    expect(
      await screen.findByText("Ticket CP-2026-000123 raised."),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem(draftKey("u-1"))).toBeNull();
  });

  it("an RSA PIN in the description calls the duplicate check; matches show the orange box and raising stays possible", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm({
      draft: {
        categoryId: "c-ar",
        subject: "Balance query",
        descriptionHtml:
          "<p>Member PEN123456789012 says the balance is short.</p>",
      },
      routes: {
        "POST /api/tickets/duplicate-check": () => [
          200,
          {
            pinsFound: ["PEN********9012"],
            matches: [
              {
                reference: "CP-2026-000045",
                status: 3,
                createdAt: twoDaysAgo,
                isYours: true,
              },
            ],
          },
        ],
      },
    });

    const box = await screen.findByTestId("duplicate-box");
    expect(box).toHaveTextContent(
      "Possible duplicate: CP-2026-000045 (In progress, raised 2 days ago)",
    );
    expect(
      within(box).getByRole("link", { name: "CP-2026-000045" }),
    ).toHaveAttribute("href", "/tickets/CP-2026-000045");
    expect(calls.duplicates[0]).toEqual({
      categoryId: "c-ar",
      subject: "Balance query",
      descriptionHtml:
        "<p>Member PEN123456789012 says the balance is short.</p>",
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await user.click(screen.getByRole("button", { name: "Raise anyway" }));
    expect(await screen.findByText("Ticket page")).toBeInTheDocument();
    expect(calls.create).toHaveLength(1);
    // Checked once more on submit, before sending.
    expect(calls.duplicates.length).toBeGreaterThanOrEqual(2);
  });
});
