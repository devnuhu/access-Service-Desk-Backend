import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

// The editor is a lazy chunk; a cold import of TipTap in a full parallel run can outlast findBy's wait.
beforeAll(() => import("@/shared/ui/RichTextEditorCore.jsx"), 60_000);

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

/** The built-in matrix, except My team + Soon, edited to Critical: the form must follow the matrix. */
const MATRIX = {
  impacts: [
    { value: 1, label: "Just me", description: "Only I am affected." },
    { value: 2, label: "My team", description: "People in my unit." },
    { value: 3, label: "My department", description: "The whole department." },
    { value: 4, label: "The whole company", description: "Everyone." },
  ],
  urgencies: [
    { value: 1, label: "It can wait", description: "Next week is fine." },
    { value: 2, label: "Soon", description: "In a day or two." },
    { value: 3, label: "Urgent", description: "Today." },
    { value: 4, label: "I cannot work", description: "Work has stopped." },
  ],
  cells: [1, 2, 3, 4].flatMap((impact) =>
    [1, 2, 3, 4].map((urgency) => {
      const sum = impact + urgency;
      const edited = impact === 2 && urgency === 2;
      return {
        impact,
        urgency,
        priority: edited ? 4 : sum >= 8 ? 4 : sum >= 6 ? 3 : sum >= 4 ? 2 : 1,
        isDefault: !edited,
      };
    }),
  ),
};

const twoDaysAgo = new Date(Date.now() - 2.2 * 24 * 3600 * 1000).toISOString();

function renderForm({
  roles = ["Requester"],
  draft,
  routes = {},
  route = "/tickets/new",
} = {}) {
  const user = makeUser({ roles });
  if (draft) {
    window.sessionStorage.setItem(draftKey(user.id), JSON.stringify(draft));
  }
  const queryClient = createTestQueryClient();
  const calls = { create: [], duplicates: [] };
  const api = installFakeApi(queryClient, {
    "GET /api/catalogue/categories": () => [200, CATALOGUE],
    "GET /api/locations": () => [200, LOCATIONS],
    "GET /api/priority-matrix": () => [200, MATRIX],
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
    { route, queryClient },
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
  it("asks who it affects and how urgent it is (both required); pre-selects the location; an empty description blocks submit", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm();

    // One department today: no Department select; no Priority dropdown any more.
    await screen.findByRole("combobox", { name: "Category" });
    expect(screen.queryByLabelText("Department")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await chooseCategory(user, "Account Reconciliation");
    expect(screen.getByText("Balances that do not agree.")).toBeInTheDocument();

    const affects = screen.getByRole("group", {
      name: "Who does this affect?",
    });
    const urgent = screen.getByRole("group", { name: "How urgent is it?" });
    expect(
      within(affects)
        .getAllByRole("radio")
        .map((r) => r.closest("label").textContent),
    ).toEqual([
      "Just meOnly I am affected.",
      "My teamPeople in my unit.",
      "My departmentThe whole department.",
      "The whole companyEveryone.",
    ]);

    await user.type(screen.getByLabelText("Subject"), "Balance wrong");
    await screen.findByRole("toolbar", { name: "Formatting" });
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    expect(
      await screen.findByText("Describe the request."),
    ).toBeInTheDocument();
    expect(affects).toHaveAccessibleDescription("Choose who this affects.");
    expect(urgent).toHaveAccessibleDescription("Choose how urgent it is.");
    expect(document.getElementById("ticket-description")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(calls.create).toHaveLength(0);
  });

  it("“We will treat this as” follows the matrix as the answers change, and is read-only", async () => {
    const user = userEvent.setup();
    renderForm();
    const preview = await screen.findByTestId("priority-preview");
    const affects = screen.getByRole("group", {
      name: "Who does this affect?",
    });
    const urgent = screen.getByRole("group", { name: "How urgent is it?" });
    expect(preview).toBeEmptyDOMElement();

    await user.click(within(affects).getByRole("radio", { name: /My team/ }));
    expect(preview).toBeEmptyDOMElement();
    await user.click(within(urgent).getByRole("radio", { name: /^Soon/ }));
    // Edited cell: Critical, not the built-in Medium.
    await waitFor(() =>
      expect(preview).toHaveTextContent(
        "We will treat this as Critical priority.",
      ),
    );
    await user.click(
      within(urgent).getByRole("radio", { name: /It can wait/ }),
    );
    expect(preview).toHaveTextContent("We will treat this as Low priority.");
    await user.click(
      within(affects).getByRole("radio", { name: /The whole company/ }),
    );
    await user.click(
      within(urgent).getByRole("radio", { name: /I cannot work/ }),
    );
    expect(preview).toHaveTextContent(
      "We will treat this as Critical priority.",
    );
    expect(within(preview).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument();
  });

  it("without the matrix the questions still show (built-in wording) and the priority line hides", async () => {
    const user = userEvent.setup();
    renderForm({
      routes: {
        "GET /api/priority-matrix": () => [500, { message: "Down." }],
      },
    });
    const affects = await screen.findByRole("group", {
      name: "Who does this affect?",
    });
    const urgent = screen.getByRole("group", { name: "How urgent is it?" });
    await user.click(
      await within(affects).findByRole("radio", { name: "Just me" }),
    );
    await user.click(within(urgent).getByRole("radio", { name: "Urgent" }));
    expect(
      within(urgent).getByRole("radio", { name: "I cannot work" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("priority-preview")).toBeEmptyDOMElement();
  });

  it("a 400 naming impact or urgency marks that question", async () => {
    const user = userEvent.setup();
    renderForm({
      draft: {
        categoryId: "c-ar",
        impact: 1,
        urgency: 1,
        subject: "Balance query",
        descriptionHtml: "<p>Please check.</p>",
      },
      routes: {
        "POST /api/tickets": () => [
          400,
          {
            message: "Some details are not valid.",
            errors: { urgency: "Choose how urgent it is." },
          },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await screen.findByRole("toolbar", { name: "Formatting" });
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    const urgent = screen.getByRole("group", { name: "How urgent is it?" });
    await waitFor(() =>
      expect(urgent).toHaveAccessibleDescription("Choose how urgent it is."),
    );
    expect(
      screen.getByRole("group", { name: "Who does this affect?" }),
    ).not.toHaveAccessibleDescription();
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
        impact: 2,
        urgency: 3,
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
    expect(form.get("impact")).toBe("2");
    expect(form.get("urgency")).toBe("3");
    expect(form.has("priority")).toBe(false);
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
        impact: 1,
        urgency: 1,
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

describe("Copy colleagues (CC) for everyone", () => {
  it("a plain requester searches /api/people/search from 2 characters and copies at most 10", async () => {
    const user = userEvent.setup();
    const searched = [];
    const nine = Array.from({ length: 9 }, (_, i) => ({
      id: `p-${i}`,
      fullName: `Person ${i}`,
      userName: `person.${i}`,
    }));
    const { calls } = renderForm({
      draft: {
        categoryId: "c-ar",
        impact: 1,
        urgency: 1,
        subject: "Balance query",
        descriptionHtml: "<p>Please check.</p>",
        cc: nine,
      },
      routes: {
        "GET /api/people/search": (config) => {
          searched.push(config.params.query);
          return [
            200,
            [
              {
                userId: "u-x",
                userName: "test.caseworker2",
                fullName: "Test Caseworker Two",
                department: "Contribution Processing",
              },
            ],
          ];
        },
      },
    });
    const box = await screen.findByLabelText("Add a colleague");
    await user.type(box, "t");
    expect(
      await screen.findByText("Type at least 2 letters."),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(searched).toHaveLength(0);

    await user.type(box, "e");
    const results = await screen.findByRole("list", {
      name: "Matching people",
    });
    expect(searched).toEqual(["te"]);
    expect(
      within(results).getByText("contribution processing", { exact: false }),
    ).toBeInTheDocument();
    await user.click(within(results).getByText("Test Caseworker Two"));

    expect(
      screen.getByText("10 people copied: the most a ticket takes."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a colleague")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await screen.findByRole("toolbar", { name: "Formatting" });
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    await waitFor(() => expect(calls.create).toHaveLength(1));
    const sent = calls.create[0].body.getAll("ccUserIds");
    expect(sent).toHaveLength(10);
    expect(sent).toContain("u-x");
  });
});

const TEMPLATES = [
  {
    categoryId: "c-ar",
    subject: "Reconcile the account of Amaka Obi",
    descriptionHtml: "<p>Employer code: </p>",
  },
  {
    categoryId: "c-uc",
    subject: "Unmatched contribution",
    descriptionHtml: "<p>Amount received: </p>",
  },
];

describe("Raise a ticket: templates", () => {
  const description = () => document.getElementById("ticket-description");

  async function renderWithTemplates() {
    const view = renderForm({
      routes: { "GET /api/catalogue/templates": () => [200, TEMPLATES] },
    });
    await waitFor(() =>
      expect(
        view.queryClient.getQueryData(["catalogue", "templates"]),
      ).toBeTruthy(),
    );
    await waitFor(() => expect(description()).not.toBeNull());
    return view;
  }

  it("fills empty fields from the category's template and swaps an untouched one on switching", async () => {
    const user = userEvent.setup();
    await renderWithTemplates();
    const subject = screen.getByLabelText("Subject");

    await chooseCategory(user, "Account Reconciliation");
    expect(subject).toHaveValue("Reconcile the account of Amaka Obi");
    await waitFor(() =>
      expect(description()).toHaveTextContent("Employer code:"),
    );
    expect(screen.getByTestId("template-hint")).toHaveTextContent(
      "Suggested by Contribution Processing: edit as needed.",
    );

    // Nothing was touched: the other category's template replaces it.
    await chooseCategory(user, "Unmatched contribution");
    expect(subject).toHaveValue("Unmatched contribution");
    await waitFor(() =>
      expect(description()).toHaveTextContent("Amount received:"),
    );
    expect(description()).not.toHaveTextContent("Employer code:");
  });

  it("never overwrites what the requester typed, before or after the suggestion", async () => {
    const user = userEvent.setup();
    await renderWithTemplates();
    const subject = screen.getByLabelText("Subject");

    // Typed first: the subject stays, the empty description gets the suggestion.
    await user.type(subject, "Balance is wrong");
    await chooseCategory(user, "Account Reconciliation");
    expect(subject).toHaveValue("Balance is wrong");
    await waitFor(() =>
      expect(description()).toHaveTextContent("Employer code:"),
    );

    // Switching keeps the typed subject; the untouched description follows the category.
    await chooseCategory(user, "Unmatched contribution");
    expect(subject).toHaveValue("Balance is wrong");
    await waitFor(() =>
      expect(description()).toHaveTextContent("Amount received:"),
    );

    // Edited after the suggestion: it is theirs now.
    await user.clear(subject);
    await user.type(subject, "Unmatched for March");
    await chooseCategory(user, "Account Reconciliation");
    expect(subject).toHaveValue("Unmatched for March");
  });
});

describe("Raise a ticket: arriving with ?categoryId=", () => {
  it("shows the chosen request type as a chip, starts at the description, and Change brings back the pickers", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm({
      route: "/tickets/new?categoryId=c-uc",
      draft: {
        impact: 1,
        urgency: 1,
        subject: "Contribution missing",
        descriptionHtml: "<p>Please check.</p>",
      },
    });
    const chip = await screen.findByTestId("chosen-category");
    expect(chip).toHaveTextContent("Unmatched contribution");
    expect(chip).toHaveTextContent("Contribution Processing");
    expect(
      screen.queryByRole("combobox", { name: "Category" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-field="descriptionHtml"] [contenteditable="true"]',
        ),
      ).toHaveFocus(),
    );

    // Change: the pickers come back with the same choice, and it is what goes.
    await user.click(within(chip).getByRole("button", { name: "Change" }));
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue(
      "Unmatched contribution",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Location")).toHaveDisplayValue("Abuja"),
    );
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    await waitFor(() => expect(calls.create).toHaveLength(1));
    expect(calls.create[0].body.get("categoryId")).toBe("c-uc");
  });

  it("an unknown categoryId leaves the form as usual", async () => {
    renderForm({ route: "/tickets/new?categoryId=nope" });
    expect(
      await screen.findByRole("combobox", { name: "Category" }),
    ).toHaveValue("");
    expect(screen.queryByTestId("chosen-category")).not.toBeInTheDocument();
  });
});

// These wait through real 500 ms debounces on a heavy form, so each gets 20 s (the default is 5 s).
describe("Raise a ticket: knowledge base suggestions", () => {
  const SUGGESTION = (id, title) => ({
    id,
    title,
    summary: `About ${title.toLowerCase()}.`,
    departmentName: "Contribution Processing",
  });

  it("offers articles once a category is chosen, refined by the subject; each opens in a new tab; Hide dismisses them", async () => {
    const user = userEvent.setup();
    const asked = [];
    renderForm({
      route: "/tickets/new?categoryId=c-uc",
      routes: {
        "GET /api/kb/suggest": ({ params }) => {
          asked.push(params);
          return [
            200,
            params.text
              ? [SUGGESTION("a-2", "Refund of excess contributions")]
              : [SUGGESTION("a-1", "Unmatched contributions")],
          ];
        },
      },
    });
    const panel = await screen.findByTestId("kb-suggestions");
    expect(panel).toHaveTextContent("These articles may answer your question");
    const link = within(panel).getByRole("link", {
      name: /Unmatched contributions/,
    });
    expect(link).toHaveAttribute("href", "/knowledge/a-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const subject = screen.getByLabelText("Subject");
    await user.clear(subject);
    await user.type(subject, "Refund");
    expect(
      await within(screen.getByTestId("kb-suggestions")).findByRole("link", {
        name: /Refund of excess contributions/,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kb-suggestions")).queryByRole("link", {
        name: /Unmatched contributions/,
      }),
    ).toBeNull();
    // Debounced: the category alone, then the full subject (nothing for 1 or 2 letters).
    expect(asked.map((p) => p.text ?? "")).toEqual(["", "Refund"]);
    expect(asked.every((p) => p.categoryId === "c-uc")).toBe(true);

    await user.click(
      within(screen.getByTestId("kb-suggestions")).getByRole("button", {
        name: "Hide",
      }),
    );
    expect(screen.queryByTestId("kb-suggestions")).not.toBeInTheDocument();
    await user.type(subject, "s");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByTestId("kb-suggestions")).not.toBeInTheDocument();
    expect(asked).toHaveLength(2);
  }, 20_000);

  it("an answer for older text never replaces the one for the current text", async () => {
    const user = userEvent.setup();
    renderForm({
      route: "/tickets/new?categoryId=c-uc",
      routes: {
        "GET /api/kb/suggest": async ({ params }) => {
          if (params.text === "Refund")
            await new Promise((resolve) => setTimeout(resolve, 900));
          return [200, [SUGGESTION(`a-${params.text}`, `For ${params.text}`)]];
        },
      },
    });
    const subject = await screen.findByLabelText("Subject");
    await user.clear(subject);
    await user.type(subject, "Refund");
    // Wait past the debounce so "Refund" is asked (slowly), then type on.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await user.type(subject, " late");
    expect(
      await within(await screen.findByTestId("kb-suggestions")).findByRole(
        "link",
        { name: /For Refund late/ },
      ),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(
      within(screen.getByTestId("kb-suggestions"))
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/knowledge/a-Refund late"]);
  }, 20_000);

  it("shows nothing when the list is empty or the call fails, and the ticket still goes", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm({
      route: "/tickets/new?categoryId=c-uc",
      draft: {
        impact: 1,
        urgency: 1,
        subject: "Contribution missing",
        descriptionHtml: "<p>Please check.</p>",
      },
      routes: {
        "GET /api/kb/suggest": ({ params }) =>
          params.text ? [500, { message: "Boom." }] : [200, []],
      },
    });
    await screen.findByTestId("chosen-category");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByTestId("kb-suggestions")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Raise ticket" }));
    await waitFor(() => expect(calls.create).toHaveLength(1));
  }, 20_000);
});
