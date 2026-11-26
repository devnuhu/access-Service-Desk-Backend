import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import TicketPage from "./TicketPage.jsx";

const person = (userId, fullName) => ({
  userId,
  userName: fullName.toLowerCase().replace(" ", "."),
  fullName,
});
const REQUESTER = person("u-req", "Rita Requester");
const WORKER = person("u-cw", "Chidi Worker");
const ADMIN = person("u-sa", "Sade Admin");

const ticket = (overrides = {}) => ({
  id: "t-1",
  reference: "CP-2026-000001",
  subject: "Balance does not agree",
  departmentCode: "CP",
  categoryName: "Account Reconciliation",
  unitName: "Contribution Matching",
  locationName: "HQ",
  priority: 2,
  status: 3,
  requester: REQUESTER,
  assignee: WORKER,
  assignedAt: "2026-11-03T09:00:05Z",
  firstRespondedAt: "2026-11-03T09:30:00Z",
  escalatedToHeadAt: null,
  escalatedToHeadReason: null,
  slaLevel: 0,
  slaDueAt: null,
  slaWarnedAt: null,
  slaBreachedAt: null,
  slaL2At: null,
  createdAt: "2026-11-03T09:00:00Z",
  updatedAt: null,
  departmentId: "d-cp",
  departmentName: "Contribution Processing",
  categoryId: "c-ar",
  unitId: "u-cm",
  locationId: "l-hq",
  requesterDepartment: "Finance",
  raisedBy: REQUESTER,
  descriptionHtml: "<p>Please check.</p>",
  cc: [],
  attachments: [],
  comments: [],
  isStaffView: false,
  canComment: true,
  canAddInternalNote: false,
  acknowledgedAt: "2026-11-03T09:30:00Z",
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

const CODES = [
  { code: 1, label: "Completed" },
  { code: 2, label: "Information provided" },
];

const flags = (overrides = {}) => ({
  canAcknowledge: false,
  canSetPending: false,
  canResume: false,
  canResolve: false,
  canConfirm: false,
  canReopen: false,
  canCancel: false,
  canEscalate: false,
  resolutionCodes: CODES,
  ...overrides,
});

/** Renders the page as `viewer`; `answers` are the workflow POST routes. */
function renderPage({
  data,
  actions = flags(),
  viewer = "u-req",
  answers = {},
}) {
  const queryClient = createTestQueryClient();
  const loads = { ticket: 0, actions: 0 };
  const sent = [];
  const posts = Object.fromEntries(
    Object.entries(answers).map(([action, answer]) => [
      `POST /api/tickets/:ticketId/${action}`,
      (config) => {
        sent.push([action, config.body]);
        return typeof answer === "function" ? answer() : answer;
      },
    ]),
  );
  installFakeApi(queryClient, {
    "GET /api/tickets/by-reference/:reference": () => {
      loads.ticket += 1;
      return [200, data];
    },
    "GET /api/tickets/:ticketId/actions": () => {
      loads.actions += 1;
      return [200, actions];
    },
    "GET /api/tickets/:ticketId/reassign-options": () => [
      200,
      { canReassign: false, reason: "No.", candidates: [] },
    ],
    ...posts,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ id: viewer }));
  renderWithProviders(
    <Routes>
      <Route path="/tickets/:reference" element={<TicketPage />} />
    </Routes>,
    { route: "/tickets/CP-2026-000001", queryClient },
  );
  return { loads, sent };
}

const callout = () => screen.findByTestId("status-callout");
const dialogNamed = (name) => screen.findByRole("dialog", { name });

describe("Action bar", () => {
  it("shows only the buttons whose flags are true, above Reassign", async () => {
    renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canSetPending: true, canResolve: true }),
    });
    // A staff page loads more (assignment, links): allow a slow full run more time.
    const card = (
      await screen.findByRole(
        "heading",
        { name: "Actions" },
        { timeout: 10_000 },
      )
    ).parentElement;
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Resolve", "Set pending"]);
    expect(
      card.compareDocumentPosition(
        await screen.findByRole("heading", { name: "Assignment" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a viewer with no flags sees no action bar", async () => {
    const { loads } = renderPage({ data: ticket(), viewer: "u-copied" });
    await callout();
    await waitFor(() => expect(loads.actions).toBe(1));
    expect(
      screen.queryByRole("heading", { name: "Actions" }),
    ).not.toBeInTheDocument();
    expect(
      within(await callout()).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("a requester with canConfirm and canReopen sees them in the Resolved callout; confirm asks first", async () => {
    const user = userEvent.setup();
    const { sent, loads } = renderPage({
      data: ticket({
        status: 5,
        resolvedAt: "2026-11-03T12:00:00Z",
        resolutionCode: 2,
        resolutionNote: "The January schedule was posted.",
      }),
      actions: flags({ canConfirm: true, canReopen: true }),
      answers: { confirm: [200, { message: "Thank you. It is closed." }] },
    });
    const box = await callout();
    await user.click(
      await within(box).findByRole("button", { name: "Confirm it's resolved" }),
    );
    expect(
      within(box).getByRole("button", { name: "It's not resolved" }),
    ).toBeInTheDocument();
    const dialog = await dialogNamed("Close the ticket?");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm it's resolved" }),
    );
    expect(
      await screen.findByText("Thank you. It is closed."),
    ).toBeInTheDocument();
    expect(sent).toEqual([["confirm", undefined]]);
    await waitFor(() => expect(loads.ticket).toBe(2));
    expect(loads.actions).toBe(2);
  });

  it("Start work needs no dialog: the toast, then everything refetches", async () => {
    const user = userEvent.setup();
    const { sent, loads } = renderPage({
      data: ticket({ status: 2, acknowledgedAt: null, isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canAcknowledge: true }),
      answers: { acknowledge: [200, { message: "Acknowledged." }] },
    });
    await user.click(await screen.findByRole("button", { name: "Start work" }));
    expect(await screen.findByText("Acknowledged.")).toBeInTheDocument();
    expect(sent).toEqual([["acknowledge", undefined]]);
    await waitFor(() => expect(loads.ticket).toBe(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a 409 on any action shows the reload message and refetches", async () => {
    const user = userEvent.setup();
    const { loads } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canSetPending: true }),
      answers: {
        pending: [409, { message: "Reload it and try again." }],
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Set pending" }),
    );
    const dialog = await dialogNamed("Set pending");
    await user.click(
      within(dialog).getByRole("radio", { name: /third party/ }),
    );
    await user.type(within(dialog).getByRole("textbox"), "The employer file.");
    await user.click(
      within(dialog).getByRole("button", { name: "Set pending" }),
    );
    expect(
      await screen.findByText(
        "The ticket changed at the same moment. It has been reloaded.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(loads.ticket).toBe(2));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("a 400 without errors and a 403 show the message in the dialog", async () => {
    const user = userEvent.setup();
    renderPage({
      data: ticket({ status: 5, resolvedAt: "2026-11-03T12:00:00Z" }),
      actions: flags({ canReopen: true }),
      answers: {
        reopen: [400, { message: "Not possible while the ticket is Closed." }],
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "It's not resolved" }),
    );
    const dialog = await dialogNamed("It's not resolved");
    await user.type(within(dialog).getByRole("textbox"), "Still short.");
    await user.click(
      within(dialog).getByRole("button", { name: "Reopen the ticket" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Not possible while the ticket is Closed.",
    );
  });
});

describe("Pending dialog", () => {
  it("requires the reason, shows errors.note from a 400, and sends { reason, note }", async () => {
    const user = userEvent.setup();
    let answer = [
      400,
      {
        message: "Some details are not valid.",
        errors: {
          note: "Say what you are waiting for (5 to 2000 characters).",
        },
      },
    ];
    const { sent } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canSetPending: true }),
      answers: { pending: () => answer },
    });
    await user.click(
      await screen.findByRole("button", { name: "Set pending" }),
    );
    const dialog = await dialogNamed("Set pending");
    const submit = within(dialog).getByRole("button", { name: "Set pending" });
    const note = within(dialog).getByLabelText(/What are you waiting for/);

    await user.type(note, "abc");
    await user.click(submit);
    expect(
      within(dialog).getByText("Choose who it is waiting on."),
    ).toBeInTheDocument();
    expect(sent).toHaveLength(0);

    await user.click(within(dialog).getByRole("radio", { name: /requester/ }));
    await user.click(submit);
    expect(
      await within(dialog).findByText(
        "Say what you are waiting for (5 to 2000 characters).",
      ),
    ).toBeInTheDocument();
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([["pending", { reason: 1, note: "abc" }]]);

    answer = [200, { message: "It is Pending." }];
    await user.type(note, "defgh");
    await user.click(submit);
    expect(await screen.findByText("It is Pending.")).toBeInTheDocument();
    expect(sent[1]).toEqual(["pending", { reason: 1, note: "abcdefgh" }]);
  });
});

describe("Resolve dialog", () => {
  it("takes the codes from resolutionCodes, sends { code, note }, and shows two field errors from one 400", async () => {
    const user = userEvent.setup();
    const { sent } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canResolve: true }),
      answers: {
        resolve: [
          400,
          {
            message: "Some details are not valid.",
            errors: {
              code: "Choose a resolution code.",
              note: "Describe the resolution (10 to 4000 characters).",
            },
          },
        ],
      },
    });
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await dialogNamed("Resolve");
    const select = within(dialog).getByLabelText("Resolution code");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choose a code", "Completed", "Information provided"]);

    await user.selectOptions(select, "Information provided");
    await user.type(within(dialog).getByRole("textbox"), "Posted.");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(
      await within(dialog).findByText("Choose a resolution code."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Describe the resolution (10 to 4000 characters).",
      ),
    ).toBeInTheDocument();
    expect(sent).toEqual([["resolve", { code: 2, note: "Posted." }]]);
  });
});

describe("Reopen and cancel", () => {
  it("reopen requires a reason", async () => {
    const user = userEvent.setup();
    const { sent } = renderPage({
      data: ticket({ status: 5, resolvedAt: "2026-11-03T12:00:00Z" }),
      actions: flags({ canReopen: true }),
      answers: { reopen: [200, { message: "Reopened." }] },
    });
    await user.click(
      await screen.findByRole("button", { name: "It's not resolved" }),
    );
    const dialog = await dialogNamed("It's not resolved");
    const submit = within(dialog).getByRole("button", {
      name: "Reopen the ticket",
    });
    await user.click(submit);
    expect(sent).toHaveLength(0);
    expect(
      within(dialog).getAllByText("Say what is still wrong."),
    ).toHaveLength(2);
    await user.type(within(dialog).getByRole("textbox"), "February is short.");
    await user.click(submit);
    expect(await screen.findByText("Reopened.")).toBeInTheDocument();
    expect(sent).toEqual([["reopen", { reason: "February is short." }]]);
  });

  it("the requester cancels from the callout; it requires a reason", async () => {
    const user = userEvent.setup();
    const { sent } = renderPage({
      data: ticket({ status: 2, acknowledgedAt: null }),
      actions: flags({ canCancel: true }),
      answers: { cancel: [200, { message: "Cancelled." }] },
    });
    const box = await callout();
    await user.click(
      await within(box).findByRole("button", { name: "Cancel ticket" }),
    );
    const dialog = await dialogNamed("Cancel this ticket?");
    const submit = within(dialog).getByRole("button", {
      name: "Cancel ticket",
    });
    await user.click(submit);
    expect(
      within(dialog).getByText("Say why it is being cancelled."),
    ).toBeInTheDocument();
    expect(sent).toHaveLength(0);
    await user.type(within(dialog).getByRole("textbox"), "Raised by mistake.");
    await user.click(submit);
    expect(await screen.findByText("Cancelled.")).toBeInTheDocument();
    expect(sent).toEqual([["cancel", { reason: "Raised by mistake." }]]);
  });

  it("a Super Admin cancelling someone else's ticket gets the wording for everyone, in the side panel", async () => {
    const user = userEvent.setup();
    renderPage({
      data: ticket({ isStaffView: true }),
      viewer: ADMIN.userId,
      actions: flags({ canCancel: true }),
    });
    const card = (await screen.findByRole("heading", { name: "Actions" }))
      .parentElement;
    await user.click(
      within(card).getByRole("button", { name: "Cancel ticket" }),
    );
    expect(
      await dialogNamed("Cancel this ticket for everyone?"),
    ).toBeInTheDocument();
  });

  const STAFF_WARNING =
    "The requester sees this reason on the ticket. Cancelling cannot be undone.";
  const actionsCard = async () =>
    (
      await screen.findByRole(
        "heading",
        { name: "Actions" },
        { timeout: 10_000 },
      )
    ).parentElement;

  it("the requester's cancel dialog has no staff warning", async () => {
    const user = userEvent.setup();
    renderPage({
      data: ticket({ status: 2, acknowledgedAt: null }),
      actions: flags({ canCancel: true }),
    });
    await user.click(
      await within(await callout()).findByRole("button", {
        name: "Cancel ticket",
      }),
    );
    const dialog = await dialogNamed("Cancel this ticket?");
    expect(within(dialog).queryByText(STAFF_WARNING)).not.toBeInTheDocument();
  });

  it("the case worker cancels from the side panel: the dialog says the requester sees the reason and it cannot be undone", async () => {
    const user = userEvent.setup();
    const { sent } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: WORKER.userId,
      actions: flags({ canCancel: true, canResolve: true }),
      answers: { cancel: [200, { message: "Cancelled." }] },
    });
    const card = await actionsCard();
    // Not in the requester's callout: the viewer is not the requester.
    expect(
      within(await callout()).queryByRole("button", { name: "Cancel ticket" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(card).getByRole("button", { name: "Cancel ticket" }),
    );
    const dialog = await dialogNamed("Cancel this ticket for everyone?");
    expect(within(dialog).getByTestId("cancel-intro")).toHaveTextContent(
      STAFF_WARNING,
    );
    await user.type(
      within(dialog).getByRole("textbox"),
      "Duplicate of CP-2026-000002.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel ticket" }),
    );
    expect(await screen.findByText("Cancelled.")).toBeInTheDocument();
    expect(sent).toEqual([
      ["cancel", { reason: "Duplicate of CP-2026-000002." }],
    ]);
  });

  it("a case worker past the deadline gets the API's refusal as it is given, and the dialog stays open", async () => {
    const user = userEvent.setup();
    const refusal =
      "This ticket has passed its deadline or its first-response time, so only the head of the unit can cancel it. Ask them.";
    renderPage({
      data: ticket({ isStaffView: true }),
      viewer: WORKER.userId,
      actions: flags({ canCancel: true }),
      answers: { cancel: [400, { message: refusal }] },
    });
    await user.click(
      within(await actionsCard()).getByRole("button", {
        name: "Cancel ticket",
      }),
    );
    const dialog = await dialogNamed("Cancel this ticket for everyone?");
    await user.type(within(dialog).getByRole("textbox"), "No longer needed.");
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel ticket" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(refusal);
    expect(
      screen.getByRole("dialog", { name: "Cancel this ticket for everyone?" }),
    ).toBeInTheDocument();
  });

  it("the unit's head (not the assignee) sees Cancel whenever the API allows it", async () => {
    renderPage({
      data: ticket({ isStaffView: true, status: 1, assignee: null }),
      viewer: "u-head",
      actions: flags({ canCancel: true }),
    });
    expect(
      within(await actionsCard()).getByRole("button", {
        name: "Cancel ticket",
      }),
    ).toBeInTheDocument();
  });

  it("staff without canCancel see no Cancel button anywhere", async () => {
    const { loads } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: WORKER.userId,
      actions: flags({ canResolve: true }),
    });
    await actionsCard();
    await waitFor(() => expect(loads.actions).toBe(1));
    expect(
      screen.queryByRole("button", { name: "Cancel ticket" }),
    ).not.toBeInTheDocument();
  });
});

describe("Status callout", () => {
  // Pending since Tue 3 Nov 11:00 WAT; now Sun 8 Nov: 5 calendar days.
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-11-08T09:00:00Z"),
      toFake: ["Date"],
    });
  });
  afterEach(() => vi.useRealTimers());
  const pending = (reason) =>
    ticket({
      status: 4,
      pendingReason: reason,
      pendingSince: "2026-11-03T10:00:00Z",
    });

  it('Pending on the requester says "Reply below to continue" to the requester only', async () => {
    renderPage({ data: pending(1) });
    const box = await callout();
    expect(box).toHaveTextContent("Waiting on you since 3 Nov (5 days).");
    expect(box).toHaveTextContent("Reply below to continue.");
    expect(
      within(box).getByRole("button", { name: "Reply" }),
    ).toBeInTheDocument();
  });

  it("the assignee sees who it is waiting on, without the reply prompt", async () => {
    renderPage({ data: pending(1), viewer: "u-cw" });
    const box = await callout();
    expect(box).toHaveTextContent(
      "Waiting on the requester since 3 Nov (5 days).",
    );
    expect(box).not.toHaveTextContent("Reply below to continue");
  });

  it("Pending on a third party", async () => {
    renderPage({ data: pending(2) });
    const box = await callout();
    expect(box).toHaveTextContent(
      "Waiting on a third party since 3 Nov (5 days).",
    );
    expect(box).not.toHaveTextContent("Reply below");
  });

  it("Resolved shows the resolution label and the note", async () => {
    renderPage({
      data: ticket({
        status: 5,
        resolvedAt: "2026-11-03T12:00:00Z",
        resolutionCode: 2,
        resolutionNote: "The January schedule was posted.",
      }),
    });
    const box = await callout();
    await waitFor(() =>
      expect(box).toHaveTextContent(/Resolved .*: Information provided\./),
    );
    expect(box).toHaveTextContent("The January schedule was posted.");
  });

  it.each([
    [
      { status: 2, acknowledgedAt: null },
      "u-req",
      /Assigned to Chidi Worker .*Waiting for them to start\./,
    ],
    [
      { status: 2, acknowledgedAt: null },
      "u-cw",
      /Assigned to you .*Start work when you pick it up\./,
    ],
    [{ status: 3 }, "u-req", /Chidi Worker started on it .*ago\./],
    [
      { status: 7, closedAt: "2026-11-04T09:00:00Z" },
      "u-req",
      /^Closed Wed 4 Nov 2026, 10:00 WAT\.$/,
    ],
    [
      { status: 8, cancelledAt: "2026-11-04T09:00:00Z", canComment: false },
      "u-req",
      /^Cancelled Wed 4 Nov 2026/,
    ],
    [
      { status: 6, reopenCount: 2 },
      "u-req",
      /^Reopened \(2 times\)\. Back with Chidi Worker\.$/,
    ],
  ])("%o as %s", async (overrides, viewer, text) => {
    renderPage({ data: ticket(overrides), viewer });
    expect(await callout()).toHaveTextContent(text);
  });
});

describe("Comments and the CC list", () => {
  it("workflow entries (kind 1) are timeline lines; a person's comment that looks like one is not", async () => {
    const comment = (id, bodyHtml, overrides = {}) => ({
      id,
      author: WORKER,
      bodyHtml,
      isInternal: false,
      kind: 0,
      createdAt: "2026-11-03T10:00:00Z",
      attachments: [],
      ...overrides,
    });
    renderPage({
      data: ticket({
        comments: [
          comment(
            "c-1",
            "<p><strong>Resolved: Completed</strong></p><p>Done.</p>",
            { kind: 1 },
          ),
          comment(
            "c-2",
            "<p><strong>Resolved: Completed</strong></p><p>Typed by hand.</p>",
          ),
        ],
      }),
    });
    const line = await screen.findByTestId("comment-c-1");
    expect(line).toHaveAttribute("data-kind", "workflow");
    expect(line).toHaveTextContent(
      "Resolved: Completed · Chidi Worker · Tue 3 Nov 2026, 11:00 WAT",
    );
    expect(line).toHaveTextContent("Done.");
    expect(within(line).getAllByText("Resolved: Completed")).toHaveLength(1);
    const typed = screen.getByTestId("comment-c-2");
    expect(typed).not.toHaveAttribute("data-kind");
    expect(within(typed).getByText("Resolved: Completed").tagName).toBe(
      "STRONG",
    );
  });

  it("someone copied and assigned shows as copied · handling it", async () => {
    renderPage({ data: ticket({ cc: [WORKER, ADMIN] }) });
    expect(
      await screen.findByText("Chidi Worker, copied · handling it"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sade Admin")).toBeInTheDocument();
  });
});

describe("Escalate to unit head", () => {
  it("shows only with canEscalate; a 3-character reason is refused by the server and shown under the field", async () => {
    const user = userEvent.setup();
    let answer = [
      400,
      {
        message: "Some details are not valid.",
        errors: {
          reason:
            "Say why it needs the head of the unit (5 to 1000 characters).",
        },
      },
    ];
    const { sent, loads } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canEscalate: true }),
      answers: { escalate: () => answer },
    });
    await user.click(
      await screen.findByRole("button", { name: "Escalate to unit head" }),
    );
    const dialog = await dialogNamed("Escalate to unit head");
    const box = within(dialog).getByRole("textbox");
    const submit = within(dialog).getByRole("button", { name: "Escalate" });

    await user.click(submit);
    expect(
      within(dialog).getByText("Say why it needs the head of the unit."),
    ).toBeInTheDocument();
    expect(sent).toHaveLength(0);

    await user.type(box, "abc");
    expect(
      within(dialog).getByText("3 of 1000 characters"),
    ).toBeInTheDocument();
    await user.click(submit);
    expect(
      await within(dialog).findByText(
        "Say why it needs the head of the unit (5 to 1000 characters).",
      ),
    ).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([["escalate", { reason: "abc" }]]);

    answer = [200, { message: "CP-2026-000001 is escalated." }];
    await user.type(box, " - the employer disputes it");
    await user.click(submit);
    expect(
      await screen.findByText("CP-2026-000001 is escalated."),
    ).toBeInTheDocument();
    expect(sent[1]).toEqual([
      "escalate",
      { reason: "abc - the employer disputes it" },
    ]);
    await waitFor(() => expect(loads.ticket).toBe(2));
  });

  it("is not offered without the flag (a head on their own ticket)", async () => {
    const { loads } = renderPage({
      data: ticket({ isStaffView: true }),
      viewer: "u-cw",
      actions: flags({ canResolve: true, canEscalate: false }),
    });
    await screen.findByRole("button", { name: "Resolve" });
    expect(loads.actions).toBe(1);
    expect(
      screen.queryByRole("button", { name: "Escalate to unit head" }),
    ).not.toBeInTheDocument();
  });

  it("an escalated ticket shows the badge with its time, and the reason to staff", async () => {
    renderPage({
      data: ticket({
        isStaffView: true,
        escalatedToHeadAt: "2026-11-03T10:00:00Z",
        escalatedToHeadReason: "The employer disputes the figures.",
      }),
      viewer: "u-hou",
    });
    const badge = await screen.findByTestId("escalated-badge");
    expect(badge).toHaveTextContent(/^Escalated to unit head .*ago$/);
    expect(badge).toHaveAttribute("title", "Tue 3 Nov 2026, 11:00 WAT");
    expect(screen.getByTestId("escalation-reason")).toHaveTextContent(
      "The employer disputes the figures.",
    );
  });

  it("the requester never sees a reason", async () => {
    renderPage({
      data: ticket({ escalatedToHeadAt: null, escalatedToHeadReason: null }),
    });
    await callout();
    expect(screen.queryByTestId("escalated-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("escalation-reason")).not.toBeInTheDocument();
  });
});
