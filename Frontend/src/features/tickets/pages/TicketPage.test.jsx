import { afterEach, describe, expect, it, vi } from "vitest";
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
import { ticketKeys } from "../hooks/useTickets.js";
import { autoReasonText } from "../ticketText.js";
import TicketPage from "./TicketPage.jsx";

const person = (userId, fullName) => ({
  userId,
  userName: fullName.toLowerCase().replace(" ", "."),
  fullName,
});
const REQUESTER = person("u-req", "Rita Requester");
const HOU = person("u-hou", "Hassan Head");

const file = (id, fileName, commentId = null) => ({
  id,
  commentId,
  fileName,
  contentType: "application/pdf",
  sizeBytes: 2048,
  uploadedBy: REQUESTER,
  uploadedAt: "2026-11-03T09:00:00Z",
});

const ticket = (overrides = {}) => ({
  id: "t-1",
  reference: "CP-2026-000001",
  subject: "Balance does not agree",
  departmentCode: "CP",
  categoryName: "Account Reconciliation",
  unitName: "Contribution Matching",
  locationName: "HQ",
  priority: 2,
  status: 1,
  requester: REQUESTER,
  assignee: null,
  createdAt: "2026-11-03T09:00:00Z",
  updatedAt: null,
  departmentId: "d-cp",
  departmentName: "Contribution Processing",
  categoryId: "c-ar",
  unitId: "u-cm",
  locationId: "l-hq",
  requesterDepartment: "Operations",
  raisedBy: REQUESTER,
  descriptionHtml:
    "<p><strong>Bold line</strong></p><table><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table>",
  cc: [],
  attachments: [file("f-1", "Statement.pdf")],
  comments: [],
  isStaffView: false,
  canComment: true,
  canAddInternalNote: false,
  assignedAt: null,
  firstRespondedAt: null,
  escalatedToHeadAt: null,
  escalatedToHeadReason: null,
  slaLevel: 0,
  slaDueAt: null,
  slaWarnedAt: null,
  slaBreachedAt: null,
  slaL2At: null,
  acknowledgedAt: null,
  pendingReason: null,
  pendingSince: null,
  resolvedAt: null,
  resolutionCode: null,
  resolutionNote: null,
  closedAt: null,
  cancelledAt: null,
  reopenCount: 0,
  ...overrides,
});

const NO_ACTIONS = {
  canAcknowledge: false,
  canSetPending: false,
  canResume: false,
  canResolve: false,
  canConfirm: false,
  canReopen: false,
  canCancel: false,
  canEscalate: false,
  resolutionCodes: [],
};

function renderTicket(routes, route = "/tickets/CP-2026-000001") {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, {
    "GET /api/tickets/:ticketId/actions": () => [200, NO_ACTIONS],
    ...routes,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ id: "u-viewer" }));
  renderWithProviders(
    <Routes>
      <Route path="/tickets/:reference" element={<TicketPage />} />
      <Route path="/tickets/id/:id" element={<TicketPage />} />
    </Routes>,
    { route, queryClient },
  );
  api.queryClient = queryClient;
  return api;
}

afterEach(() => vi.restoreAllMocks());

describe("Ticket page", () => {
  it("opening a ticket marks it read once, and its list row stops being bold", async () => {
    let reads = 0;
    const api = renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
      "POST /api/tickets/:ticketId/read": (config) => {
        reads += 1;
        expect(config.pathParams.ticketId).toBe("t-1");
        return [200, { message: "Marked as read." }];
      },
    });
    // A list the person had open before, with this ticket unread.
    const listKey = ticketKeys.list({ view: "mine", open: true });
    api.queryClient.setQueryData(listKey, {
      items: [
        { id: "t-1", unread: true },
        { id: "t-2", unread: true },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    await screen.findByRole("heading", { name: "Balance does not agree" });
    await waitFor(() => expect(reads).toBe(1));
    await waitFor(() =>
      expect(api.queryClient.getQueryData(listKey).items).toEqual([
        { id: "t-1", unread: false },
        { id: "t-2", unread: true },
      ]),
    );
    // A refetch of the ticket (a poll, a push) does not mark it again.
    await api.queryClient.refetchQueries({ queryKey: ticketKeys.tickets });
    expect(reads).toBe(1);
  });

  it("a requester sees no internal-note toggle and replies publicly", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
    });
    expect(
      await screen.findByRole("heading", { name: "Balance does not agree" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting for assignment")).toBeInTheDocument();
    expect(screen.getByText("Bold line").tagName).toBe("STRONG");
    expect(document.querySelector(".rich-text table th")).toHaveTextContent(
      "A",
    );
    expect(
      screen.queryByRole("radiogroup", { name: "Who sees it" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("staff default to Internal note; an internal note shows with the Internal chip", async () => {
    const user = userEvent.setup();
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        ticket({
          isStaffView: true,
          canAddInternalNote: true,
          raisedBy: person("u-sa", "Sade Admin"),
          comments: [
            {
              id: "cm-1",
              author: HOU,
              bodyHtml: "<p>Checked the ledger.</p>",
              isInternal: true,
              kind: 0,
              createdAt: "2026-11-03T10:00:00Z",
              attachments: [file("f-2", "Ledger.pdf", "cm-1")],
            },
            {
              id: "cm-2",
              author: HOU,
              bodyHtml: "<p>We are on it.</p>",
              isInternal: false,
              kind: 0,
              createdAt: "2026-11-03T10:05:00Z",
              attachments: [],
            },
          ],
        }),
      ],
    });
    const group = await screen.findByRole("radiogroup", {
      name: "Who sees it",
    });
    expect(
      within(group).getByRole("radio", { name: "Internal note" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      await screen.findByRole("button", { name: "Add internal note" }),
    ).toBeInTheDocument();

    const note = screen.getByTestId("comment-cm-1");
    expect(within(note).getByText("Internal")).toBeInTheDocument();
    expect(note).toHaveAttribute("data-internal", "true");
    expect(
      within(note).getByRole("button", { name: /Download Ledger.pdf/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("comment-cm-2")).queryByText("Internal"),
    ).not.toBeInTheDocument();
    // Raised for someone else.
    expect(screen.getByText(/Sade Admin for/)).toBeInTheDocument();

    await user.click(
      within(group).getByRole("radio", { name: "Public reply" }),
    );
    expect(
      screen.getByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("a 404 shows the not-found card", async () => {
    renderTicket(
      {
        "GET /api/tickets/by-reference/:reference": () => [
          404,
          { message: "Ticket not found." },
        ],
      },
      "/tickets/CP-2026-999999",
    );
    expect(
      await screen.findByText(
        "Ticket not found, or you do not have access to it.",
      ),
    ).toBeInTheDocument();
  });

  it("downloads through the HTTP client as a blob and saves under the server's file name", async () => {
    const user = userEvent.setup();
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return "blob:file-1";
    });
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click() {
        clicked.push({ href: this.href, download: this.download });
      },
    );
    let downloadConfig;
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
      "GET /api/tickets/:ticketId/attachments/:attachmentId": (config) => {
        downloadConfig = config;
        return [
          200,
          new Blob(["%PDF-1.7"], { type: "application/pdf" }),
          {
            "content-disposition": 'attachment; filename="Statement final.pdf"',
          },
        ];
      },
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Download Statement.pdf (2 KB)",
      }),
    );
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(downloadConfig.url).toBe("/api/tickets/t-1/attachments/f-1");
    expect(downloadConfig.responseType).toBe("blob");
    expect(downloadConfig.withCredentials).toBe(true);
    expect(created[0]).toBeInstanceOf(Blob);
    expect(clicked[0]).toEqual({
      href: "blob:file-1",
      download: "Statement final.pdf",
    });
  });

  it("loads by id at /tickets/id/:id; a closed ticket takes no replies", async () => {
    renderTicket(
      {
        "GET /api/tickets/:ticketId": () => [
          200,
          ticket({
            status: 7,
            canComment: false,
            closedAt: "2026-11-04T09:00:00Z",
          }),
        ],
      },
      "/tickets/id/t-1",
    );
    expect(
      await screen.findByText("This ticket is closed."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Reply" }),
    ).not.toBeInTheDocument();
  });
});

const CW1 = person("u-cw1", "Chidi One");
const CW3 = person("u-cw3", "Cara Three");
const CW2 = person("u-cw2", "Cole Two");

const staffTicket = (overrides = {}) =>
  ticket({
    status: 2,
    assignee: CW1,
    assignedAt: "2026-11-03T09:00:05Z",
    isStaffView: true,
    canAddInternalNote: true,
    ...overrides,
  });

const candidate = (who, overrides = {}) => ({
  userId: who.userId,
  userName: who.userName,
  fullName: who.fullName,
  unitId: "u-cm",
  unitName: "Contribution Matching",
  handlesCategory: true,
  workload: 2,
  isCurrentAssignee: false,
  ...overrides,
});

const HISTORY = [
  {
    id: "a-1",
    at: "2026-11-03T09:00:05Z",
    method: 1,
    reason: "raised",
    from: null,
    to: CW1,
    by: null,
    fromUnitName: "Contribution Matching",
    toUnitName: "Contribution Matching",
    scores: [
      {
        ...CW1,
        workload: 1,
        openTickets: 1,
        lastAssignedAt: null,
        chosen: true,
      },
      {
        ...CW3,
        workload: 3,
        openTickets: 2,
        lastAssignedAt: "2026-11-02T15:00:00Z",
        chosen: false,
      },
    ],
  },
  {
    id: "a-2",
    at: "2026-11-03T10:00:00Z",
    method: 2,
    reason: "Belongs to Refund: excess contribution.",
    from: CW1,
    to: CW2,
    by: HOU,
    fromUnitName: "Contribution Matching",
    toUnitName: "Refund",
    scores: [],
  },
  {
    id: "a-3",
    at: "2026-11-03T11:00:00Z",
    method: 1,
    reason: "assignee unavailable",
    from: CW2,
    to: CW3,
    by: null,
    fromUnitName: "Refund",
    toUnitName: "Refund",
    scores: [],
  },
];

describe("Assignment panel", () => {
  it("is hidden for a requester, who never calls reassign-options or the history", async () => {
    let calls = 0;
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        ticket({ status: 2, assignee: CW1 }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => {
        calls += 1;
        return [403, { message: "No." }];
      },
      "GET /api/tickets/:ticketId/assignments": () => {
        calls += 1;
        return [403, { message: "No." }];
      },
    });
    expect(await screen.findByTestId("status-callout")).toHaveTextContent(
      "Assigned to Chidi One",
    );
    expect(
      screen.queryByRole("heading", { name: "Assignment" }),
    ).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("shows the reason instead of a button when the person cannot reassign", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, staffTicket()],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        {
          canReassign: false,
          reason:
            "Only the person handling it, the head of Contribution Matching, the Head of Department or a Super Admin can reassign it.",
          candidates: [],
        },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [
        200,
        HISTORY.slice(0, 1),
      ],
    });
    expect(
      await screen.findByText(/Only the person handling it, the head of/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reassign" }),
    ).not.toBeInTheDocument();
    const block = screen.getByTestId("assignee-block");
    expect(within(block).getByText("Chidi One")).toBeInTheDocument();
    expect(await within(block).findByText(/Assigned/)).toBeInTheDocument();
  });

  it("reassigns: the current assignee cannot be chosen, another unit warns, errors.reason shows under the field", async () => {
    const user = userEvent.setup();
    const sent = [];
    let answer = [
      400,
      {
        message: "Give a reason (5 to 500 characters).",
        errors: { reason: "Say why it belongs to Refund." },
      },
    ];
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, staffTicket()],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        {
          canReassign: true,
          reason: null,
          candidates: [
            candidate(CW1, { isCurrentAssignee: true, workload: 4 }),
            candidate(CW3, { workload: 1 }),
            candidate(CW2, {
              unitId: "u-rf",
              unitName: "Refund",
              handlesCategory: false,
              workload: 0,
            }),
          ],
        },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [
        200,
        HISTORY.slice(0, 1),
      ],
      "POST /api/tickets/:ticketId/reassign": (config) => {
        sent.push(config.body);
        return answer;
      },
    });
    await user.click(await screen.findByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Reassign CP-2026-000001",
    });

    // Grouped by unit; the current assignee is shown but disabled.
    expect(within(dialog).getByText("Refund")).toBeInTheDocument();
    const current = within(dialog).getByTestId("candidate-chidi.one");
    expect(within(current).getByRole("radio")).toBeDisabled();
    expect(within(current).getByText("Current")).toBeInTheDocument();
    expect(within(current).getByText("Workload 4")).toBeInTheDocument();

    const other = within(dialog).getByTestId("candidate-cole.two");
    expect(within(other).getByText("Not mapped")).toBeInTheDocument();
    await user.click(within(other).getByRole("radio"));
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "This moves the ticket to Refund.",
    );

    // Too short in the browser, then the server's own field error.
    await user.type(within(dialog).getByLabelText("Reason"), "abc");
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(
      within(dialog).getByText("Give a reason (5 to 500 characters)."),
    ).toBeInTheDocument();
    expect(sent).toHaveLength(0);
    await user.type(within(dialog).getByLabelText("Reason"), "defgh");
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(
      await within(dialog).findByText("Say why it belongs to Refund."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Reason")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(sent[0]).toEqual({ toUserId: "u-cw2", reason: "abcdefgh" });

    answer = [200, { message: "Ticket CP-2026-000001 is now with Cole Two." }];
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(
      await screen.findByText("Ticket CP-2026-000001 is now with Cole Two."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Reassign CP-2026-000001" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("a 409 says the ticket changed and reloads", async () => {
    const user = userEvent.setup();
    let loads = 0;
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => {
        loads += 1;
        return [200, staffTicket()];
      },
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: true, reason: null, candidates: [candidate(CW3)] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
      "POST /api/tickets/:ticketId/reassign": () => [
        409,
        {
          message:
            "The ticket changed at the same moment. Reload it and try again.",
        },
      ],
    });
    await user.click(await screen.findByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio"));
    await user.type(within(dialog).getByLabelText("Reason"), "Too busy today.");
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    expect(
      await screen.findByText(
        "The ticket changed at the same moment. It has been reloaded.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(loads).toBeGreaterThan(1));
  });

  it("history: Auto with its score table (chosen highlighted), Reassigned with its reason, plain words", async () => {
    const user = userEvent.setup();
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({ assignee: CW3, unitName: "Refund" }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, HISTORY],
    });
    const toggle = await screen.findByRole("button", {
      name: /Assignment history/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    const auto = await screen.findByTestId("assignment-a-1");
    expect(within(auto).getByText("Auto")).toBeInTheDocument();
    expect(within(auto).getByText("When it was raised")).toBeInTheDocument();
    expect(within(auto).getByText("To Chidi One")).toBeInTheDocument();
    await user.click(
      within(auto).getByRole("button", { name: "Why Chidi One? (2 compared)" }),
    );
    const rows = within(auto).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const chosen = rows.find((row) => row.dataset.chosen);
    expect(chosen).toHaveTextContent("Chidi One (chosen)");
    expect(rows[2].querySelectorAll("td")[1]).toHaveTextContent("2");
    expect(rows[2].querySelectorAll("td")[2]).toHaveTextContent("3");

    const moved = screen.getByTestId("assignment-a-2");
    expect(
      within(moved).getByText("Reassigned by Hassan Head"),
    ).toBeInTheDocument();
    expect(moved).toHaveTextContent(
      "Chidi One (Contribution Matching) → Cole Two (Refund)",
    );
    expect(moved).toHaveTextContent("Belongs to Refund: excess contribution.");

    expect(
      within(screen.getByTestId("assignment-a-3")).getByText(
        "Because the assignee was unavailable",
      ),
    ).toBeInTheDocument();
    expect(autoReasonText("reopened while the assignee is unavailable")).toBe(
      "When it was reopened and the assignee was unavailable",
    );
  });
});

describe("SLA and first response", () => {
  it("staff see the Overdue badge and when each alert was sent", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({
          slaLevel: 2,
          firstRespondedAt: "2026-11-03T09:30:00Z",
          slaWarnedAt: "2026-11-03T12:00:00Z",
          slaBreachedAt: "2026-11-04T09:00:00Z",
          slaL2At: null,
        }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
    });
    expect(await screen.findByTestId("sla-badge")).toHaveTextContent("Overdue");
    expect(screen.getByTestId("detail-first-response")).toHaveTextContent(
      "Tue 3 Nov 2026, 10:30 WAT",
    );
    const history = await screen.findByTestId("sla-history");
    expect(
      [...history.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual([
      "Warning sentTue 3 Nov 2026, 13:00 WAT",
      "Marked overdueWed 4 Nov 2026, 10:00 WAT",
    ]);
  });

  it("far past says so and lists the report to the Head of Department", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({
          slaLevel: 3,
          slaWarnedAt: "2026-11-03T12:00:00Z",
          slaBreachedAt: "2026-11-04T09:00:00Z",
          slaL2At: "2026-11-05T09:00:00Z",
        }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
    });
    expect(await screen.findByTestId("sla-badge")).toHaveTextContent(
      "Far past",
    );
    expect(
      await screen.findByText("Reported to the Head of Department"),
    ).toBeInTheDocument();
    // Assigned, nobody has answered yet
    expect(screen.getByTestId("detail-first-response")).toHaveTextContent(
      "Waiting",
    );
  });

  it("staff see Due with the full WAT time and how long until then", async () => {
    vi.useFakeTimers({
      now: new Date("2026-11-17T09:00:00Z"),
      toFake: ["Date"],
    });
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({ status: 3, slaDueAt: "2026-11-17T14:00:00Z" }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
    });
    const due = await screen.findByTestId("detail-due");
    expect(due).toHaveTextContent("Tue 17 Nov 2026, 15:00 WAT");
    expect(due).toHaveTextContent("in 5 hours");
    vi.useRealTimers();
  });

  it("a passed due time says how long ago", async () => {
    vi.useFakeTimers({
      now: new Date("2026-11-17T09:00:00Z"),
      toFake: ["Date"],
    });
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({
          status: 3,
          slaLevel: 2,
          slaDueAt: "2026-11-17T07:00:00Z",
        }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
    });
    const due = await screen.findByTestId("detail-due");
    expect(due).toHaveTextContent("Tue 17 Nov 2026, 08:00 WAT");
    expect(due).toHaveTextContent("2 hours ago");
    vi.useRealTimers();
  });

  it("no Due row when the API sends null (Pending, finished, requester)", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({ status: 4, slaDueAt: null }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [200, []],
    });
    await screen.findByRole("heading", { name: "Balance does not agree" });
    expect(screen.queryByTestId("detail-due")).not.toBeInTheDocument();
    expect(screen.queryByText("Due")).not.toBeInTheDocument();
  });

  it("a requester sees no SLA badge or alerts; First response is a dash before assignment", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
    });
    await screen.findByRole("heading", { name: "Balance does not agree" });
    expect(screen.queryByTestId("sla-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sla-history")).not.toBeInTheDocument();
    expect(screen.getByTestId("detail-first-response")).toHaveTextContent("—");
  });
});

describe("Pick this ticket", () => {
  const orgWith = (flags) => ({
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
            isHead: false,
            isMember: false,
            ...flags,
          },
        ],
      },
    ],
  });

  it("a member of the unit picks a New ticket and stays on it", async () => {
    const user = userEvent.setup();
    const picked = [];
    let current = ticket();
    renderTicket({
      "GET /api/org/me": () => [200, orgWith({ isMember: true })],
      "GET /api/tickets/by-reference/:reference": () => [200, current],
      "POST /api/tickets/:ticketId/pick": (config) => {
        picked.push(config.pathParams.ticketId);
        current = ticket({ status: 2, assignee: person("u-viewer", "Me") });
        return [200, { message: "CP-2026-000001 is now assigned to you." }];
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Pick this ticket" }),
    );
    expect(
      await screen.findByText("CP-2026-000001 is now assigned to you."),
    ).toBeInTheDocument();
    expect(picked).toEqual(["t-1"]);
    // Refreshed: no longer New, so the button goes.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Pick this ticket" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows the server's message when the pick is refused (403)", async () => {
    const user = userEvent.setup();
    renderTicket({
      "GET /api/org/me": () => [200, orgWith({ isMember: true })],
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
      "POST /api/tickets/:ticketId/pick": () => [
        403,
        { message: "You do not handle this category." },
      ],
    });
    await user.click(
      await screen.findByRole("button", { name: "Pick this ticket" }),
    );
    expect(
      await screen.findByText("You do not handle this category."),
    ).toBeInTheDocument();
  });

  it("is not offered outside the unit, or once the ticket has left New", async () => {
    renderTicket({
      "GET /api/org/me": () => [200, orgWith({ isMember: false })],
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
    });
    expect(
      await screen.findByRole("heading", { name: "Balance does not agree" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("pick-card")).not.toBeInTheDocument(),
    );
  });

  it("is not offered for a ticket that is no longer New", async () => {
    renderTicket({
      "GET /api/org/me": () => [200, orgWith({ isMember: true })],
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        ticket({ status: 2 }),
      ],
    });
    expect(
      await screen.findByRole("heading", { name: "Balance does not agree" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pick-card")).not.toBeInTheDocument();
  });

  it("the assignment history says who picked it", async () => {
    const user = userEvent.setup();
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        staffTicket({ assignee: CW1 }),
      ],
      "GET /api/tickets/:ticketId/reassign-options": () => [
        200,
        { canReassign: false, reason: "No.", candidates: [] },
      ],
      "GET /api/tickets/:ticketId/assignments": () => [
        200,
        [
          {
            id: "a-9",
            at: "2026-11-03T09:10:00Z",
            method: 3,
            reason: "Picked from the unit pool",
            from: null,
            to: CW1,
            by: CW1,
            fromUnitName: "Contribution Matching",
            toUnitName: "Contribution Matching",
            scores: [],
          },
        ],
      ],
    });
    await user.click(
      await screen.findByRole("button", { name: /Assignment history/ }),
    );
    const entry = await screen.findByTestId("assignment-a-9");
    expect(within(entry).getByText("Picked by Chidi One")).toBeInTheDocument();
    expect(
      within(entry).getByText("Picked from the unit pool"),
    ).toBeInTheDocument();
  });
});
