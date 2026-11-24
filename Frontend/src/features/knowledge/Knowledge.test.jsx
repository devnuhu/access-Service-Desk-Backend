import { beforeAll, describe, expect, it } from "vitest";
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
import ArticleEditorPage, {
  PUBLISHER_NOTE,
} from "./pages/ArticleEditorPage.jsx";
import ArticlePage from "./pages/ArticlePage.jsx";
import KnowledgePage from "./pages/KnowledgePage.jsx";
import ManageArticlesPage from "./pages/ManageArticlesPage.jsx";

// The editor is a lazy chunk; load it before the first test so findBy does not wait on it.
beforeAll(() => import("@/shared/ui/RichTextEditorCore.jsx"), 60_000);

const CP = { id: "d-cp", name: "Contribution Processing" };
const BP = { id: "d-bp", name: "Benefit Processing" };
const RECON = { id: "c-ar", name: "Account Reconciliation" };

const item = (id, title, overrides = {}) => ({
  id,
  title,
  summary: `What to do about ${title.toLowerCase()}.`,
  department: CP,
  category: RECON,
  status: "Published",
  updatedAt: "2026-11-12T09:00:00Z",
  yes: 0,
  no: 0,
  ...overrides,
});

const page = (items, overrides = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  departments: [
    { ...CP, count: 3 },
    { ...BP, count: 1 },
  ],
  ...overrides,
});

const article = (overrides = {}) => ({
  ...item("a-1", "Unmatched contributions"),
  bodyHtml: "<p>Check the <strong>schedule</strong> first.</p>",
  createdAt: "2026-11-10T09:00:00Z",
  updatedAt: "2026-11-12T09:00:00Z",
  publishedAt: "2026-11-11T09:00:00Z",
  author: { userId: "u-ada", userName: "ada.obi", fullName: "Ada Obi" },
  myVote: null,
  canEdit: false,
  canPublish: false,
  canDelete: false,
  ...overrides,
});

const OPTION = (overrides = {}) => ({
  ...CP,
  canPublish: false,
  categories: [RECON, { id: "c-uc", name: "Unmatched contribution" }],
  ...overrides,
});

/** The knowledge pages with a route table; `calls` records every kb request (method, path, query, body). */
function renderKb(route, routes = {}) {
  const queryClient = createTestQueryClient();
  const calls = [];
  const wrapped = Object.fromEntries(
    Object.entries({
      "GET /api/kb/options": () => [200, []],
      "GET /api/catalogue/categories": () => [
        200,
        [
          {
            departmentId: CP.id,
            code: "CP",
            name: CP.name,
            categories: [
              {
                id: RECON.id,
                name: RECON.name,
                description: null,
                defaultPriority: 2,
              },
            ],
          },
        ],
      ],
      ...routes,
    }).map(([key, handler]) => [
      key,
      (config) => {
        if (key.includes("/api/kb"))
          calls.push({
            key,
            query: config.params ?? {},
            body: config.body ?? null,
            id: config.pathParams?.id,
          });
        return handler(config);
      },
    ]),
  );
  installFakeApi(queryClient, wrapped);
  queryClient.setQueryData(SESSION_KEY, makeUser());
  const view = renderWithProviders(
    <Routes>
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route path="/knowledge/manage" element={<ManageArticlesPage />} />
      <Route path="/knowledge/manage/new" element={<ArticleEditorPage />} />
      <Route
        path="/knowledge/manage/:id/edit"
        element={<ArticleEditorPage />}
      />
      <Route path="/knowledge/:id" element={<ArticlePage />} />
    </Routes>,
    { route, queryClient },
  );
  return { ...view, calls };
}

const listCalls = (calls, key = "GET /api/kb") =>
  calls.filter((c) => c.key === key);

describe("Knowledge base list", () => {
  it("shows cards, the department chips with counts, and pages", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge", {
      "GET /api/kb": ({ params }) => [
        200,
        page(
          [
            item(`a-${params.page}`, `Article on page ${params.page}`, {
              category: params.page === 1 ? RECON : null,
            }),
          ],
          { total: 45, page: params.page },
        ),
      ],
    });
    const card = await screen.findByTestId("kb-article-a-1");
    expect(
      within(card).getByRole("link", { name: "Article on page 1" }),
    ).toHaveAttribute("href", "/knowledge/a-1");
    expect(card).toHaveTextContent("What to do about article on page 1.");
    expect(card).toHaveTextContent("Contribution Processing");
    expect(card).toHaveTextContent("Account Reconciliation");
    expect(card).toHaveTextContent("Updated 12 Nov");

    const chips = within(screen.getByTestId("kb-departments"))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(chips).toEqual([
      "All departments",
      "Contribution Processing3",
      "Benefit Processing1",
    ]);
    expect(screen.getByTestId("kb-total")).toHaveTextContent("45 articles");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByTestId("kb-article-a-2")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(listCalls(calls).map((c) => c.query.page)).toEqual([1, 2]);
  });

  it("filters by department chip and then by category", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge", {
      "GET /api/kb": () => [200, page([item("a-1", "One")])],
    });
    await screen.findByTestId("kb-article-a-1");
    expect(screen.queryByLabelText("Category")).toBeNull();
    const chip = screen.getByRole("button", {
      name: /Contribution Processing/,
    });
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.selectOptions(
      await screen.findByLabelText("Category"),
      "Account Reconciliation",
    );
    await waitFor(() =>
      expect(listCalls(calls).at(-1).query).toMatchObject({
        departmentId: "d-cp",
        categoryId: "c-ar",
      }),
    );
  });

  it("debounces the search: one request for what was typed", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge", {
      "GET /api/kb": () => [200, page([item("a-1", "One")])],
    });
    await screen.findByTestId("kb-article-a-1");
    await user.type(screen.getByLabelText("Search articles"), "refund");
    await waitFor(() =>
      expect(listCalls(calls).at(-1).query.search).toBe("refund"),
    );
    const searches = listCalls(calls).map((c) => c.query.search ?? "");
    expect(searches).toEqual(["", "refund"]);
  });

  it('says "No articles yet." when there are none', async () => {
    renderKb("/knowledge", {
      "GET /api/kb": () => [200, page([], { departments: [] })],
    });
    expect(await screen.findByText("No articles yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-departments")).toBeNull();
  });
});

describe("Article page", () => {
  it("renders the body, highlights my vote, and switches it with the counts the call returns", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge/a-1", {
      "GET /api/kb/:id": () => [200, article({ myVote: true, yes: 5, no: 1 })],
      "POST /api/kb/:id/vote": ({ body }) => [
        200,
        { yes: 4, no: 2, myVote: body.helpful },
      ],
    });
    expect(
      await screen.findByRole("heading", { name: "Unmatched contributions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("schedule").tagName).toBe("STRONG");
    expect(screen.getByTestId("kb-updated")).toHaveTextContent(
      "Updated Thu 12 Nov 2026, 10:00 WAT",
    );
    expect(screen.queryByTestId("kb-draft-banner")).toBeNull();
    const helpful = screen.getByTestId("kb-helpful");
    const yes = within(helpful).getByRole("button", { name: "Yes" });
    const no = within(helpful).getByRole("button", { name: "No" });
    expect(yes).toHaveAttribute("aria-pressed", "true");
    expect(no).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("kb-helpful-count")).toHaveTextContent(
      "5 found this helpful",
    );

    // The same answer again does nothing; the other one changes it.
    await user.click(yes);
    await user.click(no);
    expect(
      await within(helpful).findByText("Thanks for the feedback."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("kb-helpful-count")).toHaveTextContent(
      "4 found this helpful",
    );
    expect(no).toHaveAttribute("aria-pressed", "true");
    expect(yes).toHaveAttribute("aria-pressed", "false");
    expect(
      calls.filter((c) => c.key === "POST /api/kb/:id/vote").map((c) => c.body),
    ).toEqual([{ helpful: false }]);
  });

  it("shows no actions without the flags", async () => {
    renderKb("/knowledge/a-1", {
      "GET /api/kb/:id": () => [200, article()],
    });
    await screen.findByTestId("kb-helpful");
    expect(screen.queryByTestId("kb-actions")).toBeNull();
  });

  it("a draft has the banner and no vote; the buttons follow canEdit, canPublish and canDelete", async () => {
    const user = userEvent.setup();
    let state = article({
      status: "Draft",
      publishedAt: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
    });
    const { calls, router } = renderKb("/knowledge/a-1", {
      "GET /api/kb/:id": () => [200, state],
      "POST /api/kb/:id/publish": () => {
        state = { ...state, status: "Published" };
        return [200, state];
      },
      "DELETE /api/kb/:id": () => [200, { message: "Article deleted." }],
    });
    expect(await screen.findByTestId("kb-draft-banner")).toHaveTextContent(
      "Draft – only your department can see this.",
    );
    expect(screen.queryByTestId("kb-helpful")).toBeNull();
    const actions = screen.getByTestId("kb-actions");
    expect(within(actions).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/knowledge/manage/a-1/edit",
    );
    await user.click(within(actions).getByRole("button", { name: "Publish" }));
    expect(
      await within(actions).findByRole("button", { name: "Unpublish" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("kb-draft-banner")).toBeNull();
    expect(screen.getByTestId("kb-helpful")).toBeInTheDocument();

    await user.click(within(actions).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Delete this article?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/knowledge"),
    );
    expect(calls.some((c) => c.key === "DELETE /api/kb/:id")).toBe(true);
  });

  it("only Delete when that is the only flag", async () => {
    renderKb("/knowledge/a-1", {
      "GET /api/kb/:id": () => [200, article({ canDelete: true })],
    });
    const actions = await screen.findByTestId("kb-actions");
    expect(
      within(actions)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Delete"]);
    expect(within(actions).queryByRole("link")).toBeNull();
  });

  it("a 404 says the article was not found", async () => {
    renderKb("/knowledge/a-9", {
      "GET /api/kb/:id": () => [404, { message: "Article not found." }],
    });
    expect(await screen.findByText("Article not found")).toBeInTheDocument();
  });
});

describe("Write articles", () => {
  it("without options it says so and never asks for the drafts", async () => {
    const { calls } = renderKb("/knowledge/manage");
    expect(
      await screen.findByText("You do not write articles for any department."),
    ).toBeInTheDocument();
    expect(listCalls(calls, "GET /api/kb/manage")).toHaveLength(0);
  });

  it("lists drafts and published articles with their counts, and filters by status", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge/manage", {
      "GET /api/kb/options": () => [200, [OPTION()]],
      "GET /api/kb/manage": () => [
        200,
        page([
          item("a-1", "Published one", { yes: 3, no: 1 }),
          item("a-2", "A draft", { status: "Draft", category: null }),
        ]),
      ],
    });
    const table = await screen.findByTestId("kb-manage-table");
    const row = within(table).getByTestId("kb-row-a-1");
    expect(row).toHaveTextContent("Published one");
    expect(row).toHaveTextContent("Contribution Processing");
    expect(row).toHaveTextContent("Account Reconciliation");
    expect(row).toHaveTextContent("Published");
    expect(row).toHaveTextContent("12 Nov");
    expect(row).toHaveTextContent("3 yes · 1 no");
    expect(within(table).getByTestId("kb-row-a-2")).toHaveTextContent("Draft");
    expect(screen.getByRole("link", { name: "New article" })).toHaveAttribute(
      "href",
      "/knowledge/manage/new",
    );

    await user.selectOptions(screen.getByLabelText("Status"), "Draft");
    await waitFor(() =>
      expect(listCalls(calls, "GET /api/kb/manage").at(-1).query.status).toBe(
        "draft",
      ),
    );
  });
});

describe("Article editor", () => {
  it("a writer who cannot publish sees Save draft, the note and no Publish; the browser checks the limits", async () => {
    const user = userEvent.setup();
    const { calls } = renderKb("/knowledge/manage/new", {
      "GET /api/kb/options": () => [200, [OPTION()]],
    });
    const form = await screen.findByTestId("kb-editor");
    // One department: chosen already, and its categories offered.
    expect(within(form).getByLabelText("Department")).toHaveValue("d-cp");
    expect(
      within(within(form).getByLabelText("Category (optional)"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "No category",
      "Account Reconciliation",
      "Unmatched contribution",
    ]);
    expect(screen.getByTestId("kb-publisher-note")).toHaveTextContent(
      PUBLISHER_NOTE,
    );
    expect(within(form).queryByRole("button", { name: "Publish" })).toBeNull();

    await user.type(within(form).getByLabelText("Title"), "Abc");
    await user.type(within(form).getByLabelText("Summary"), "Short");
    expect(within(form).getByText("5 of 500 characters")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save draft" }));
    expect(
      within(form).getByText("Use 5 to 200 characters."),
    ).toBeInTheDocument();
    expect(
      within(form).getByText("Use 10 to 500 characters."),
    ).toBeInTheDocument();
    expect(within(form).getByText("Write the article.")).toBeInTheDocument();
    expect(calls.some((c) => c.key === "POST /api/kb")).toBe(false);
  });

  it("a publisher sees Publish", async () => {
    renderKb("/knowledge/manage/new", {
      "GET /api/kb/options": () => [200, [OPTION({ canPublish: true })]],
    });
    const form = await screen.findByTestId("kb-editor");
    expect(
      within(form).getByRole("button", { name: "Publish" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("kb-publisher-note")).toBeNull();
  });

  it("editing: the department is fixed; the API's field errors show under the fields", async () => {
    const user = userEvent.setup();
    const sent = [];
    renderKb("/knowledge/manage/a-1/edit", {
      "GET /api/kb/options": () => [200, [OPTION()]],
      "GET /api/kb/:id": () => [
        200,
        article({ status: "Draft", canEdit: true, category: null }),
      ],
      "PUT /api/kb/:id": ({ body }) => {
        sent.push(body);
        return [
          400,
          {
            message: "Check the 2 highlighted fields.",
            errors: {
              title: "An article with this title already exists here.",
              bodyHtml: "Write at least 20 characters.",
            },
          },
        ];
      },
    });
    const form = await screen.findByTestId("kb-editor");
    expect(screen.getByTestId("kb-department-fixed")).toHaveTextContent(
      "Contribution Processing",
    );
    expect(within(form).getByLabelText("Title")).toHaveValue(
      "Unmatched contributions",
    );
    await user.click(within(form).getByRole("button", { name: "Save draft" }));
    expect(
      await within(form).findByText(
        "An article with this title already exists here.",
      ),
    ).toBeInTheDocument();
    expect(
      within(form).getByText("Write at least 20 characters."),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText("Title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(sent[0]).toMatchObject({
      departmentId: "d-cp",
      categoryId: null,
      title: "Unmatched contributions",
      summary: "What to do about unmatched contributions.",
    });
  });

  it("a publisher saves and publishes a draft, then lands on the article", async () => {
    const user = userEvent.setup();
    let state = article({ status: "Draft", canEdit: true, canPublish: true });
    const { calls, router } = renderKb("/knowledge/manage/a-1/edit", {
      "GET /api/kb/options": () => [200, [OPTION({ canPublish: true })]],
      "GET /api/kb/:id": () => [200, state],
      "PUT /api/kb/:id": () => [200, state],
      "POST /api/kb/:id/publish": () => {
        state = { ...state, status: "Published" };
        return [200, state];
      },
    });
    const form = await screen.findByTestId("kb-editor");
    await user.click(within(form).getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/knowledge/a-1"),
    );
    expect(calls.map((c) => c.key)).toEqual(
      expect.arrayContaining(["PUT /api/kb/:id", "POST /api/kb/:id/publish"]),
    );
  });

  it("a published article I cannot change is shown read only with the note", async () => {
    renderKb("/knowledge/manage/a-1/edit", {
      "GET /api/kb/options": () => [200, [OPTION()]],
      "GET /api/kb/:id": () => [200, article()],
    });
    expect(await screen.findByTestId("kb-readonly-note")).toHaveTextContent(
      PUBLISHER_NOTE,
    );
    expect(screen.getByTestId("kb-readonly")).toHaveTextContent(
      "Check the schedule first.",
    );
    expect(screen.queryByTestId("kb-editor")).toBeNull();
  });
});
