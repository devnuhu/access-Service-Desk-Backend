import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { SESSION_KEY } from "@/features/auth";
import { installFakeApi } from "@/test/fakeApi";
import {
  createTestQueryClient,
  makeUser,
  renderWithProviders,
} from "@/test/render";
import {
  blockingTasks,
  formatTaskDue,
  openTasksText,
  taskOutcomeText,
  tasksBlockResolve,
  tasksMarkerText,
  tasksSummary,
} from "../tasks.js";
import TicketPage from "./TicketPage.jsx";

const person = (userId, fullName) => ({
  userId,
  userName: fullName.toLowerCase().replace(" ", "."),
  fullName,
});
const REQUESTER = person("u-req", "Rita Requester");
const WORKER = person("u-cw", "Chidi Worker");
const OTHER = person("u-ola", "Ola Other");
const LEFT = person("u-left", "Lola Left");

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
  requesterDepartment: null,
  raisedBy: REQUESTER,
  descriptionHtml: "<p>Details</p>",
  cc: [],
  attachments: [],
  comments: [],
  isStaffView: true,
  canComment: true,
  canAddInternalNote: true,
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
  { code: 4, label: "Duplicate" },
  { code: 6, label: "Raised in error" },
];

const actions = (overrides = {}) => ({
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

/** An open task; the flags default to what the ticket's case worker gets. */
const task = (id, title, overrides = {}) => ({
  id,
  title,
  status: "Open",
  assignee: null,
  createdBy: WORKER,
  dueDate: null,
  isDone: false,
  doneAt: null,
  doneBy: null,
  isOverdue: false,
  createdAt: "2026-11-03T10:00:00Z",
  rejectedBy: null,
  rejectedAt: null,
  rejectedReason: null,
  cancelledBy: null,
  cancelledAt: null,
  cancelledReason: null,
  canComplete: true,
  canReject: false,
  canCancel: true,
  ...overrides,
});
const finished = { canComplete: false, canReject: false, canCancel: false };

const tasksOf = (items, canEdit = true) => {
  const count = (status) => items.filter((t) => t.status === status).length;
  return {
    items,
    open: count("Open"),
    done: count("Done"),
    rejected: count("Rejected"),
    cancelled: count("Cancelled"),
    canEdit,
  };
};

/** The new state of one task in the store. */
function change(store, taskId, update) {
  store.items = store.items.map((t) =>
    t.id === taskId ? { ...t, ...update } : t,
  );
  return store.items.find((t) => t.id === taskId);
}

/**
 * The ticket page as `viewer`, with a tasks store the routes change. `routes` add or override
 * handlers; `calls` records every tasks request ("METHOD path" with the body).
 */
function renderPage({
  data = ticket(),
  items = [],
  canEdit = true,
  viewer = "u-cw",
  flags = actions(),
  routes = {},
} = {}) {
  const queryClient = createTestQueryClient();
  const store = { items: [...items] };
  const calls = [];
  const record = (label) => (config) => {
    calls.push([label, config.body ?? null, config.pathParams]);
  };
  installFakeApi(queryClient, {
    "GET /api/tickets/by-reference/:reference": () => [200, data],
    "GET /api/tickets/:ticketId/actions": () => [200, flags],
    "GET /api/tickets/:ticketId/tasks/owners": (config) => {
      record("OWNERS")(config);
      return [200, [WORKER, OTHER]];
    },
    "GET /api/tickets/:ticketId/reassign-options": () => {
      throw new Error("the owner picker must not use reassign-options");
    },
    "GET /api/tickets/:ticketId/tasks": (config) => {
      record("GET")(config);
      return [200, tasksOf(store.items, canEdit)];
    },
    "POST /api/tickets/:ticketId/tasks": (config) => {
      record("POST")(config);
      const made = task(`k-${store.items.length + 1}`, config.body.title);
      store.items.push(made);
      return [200, made];
    },
    "PUT /api/tickets/:ticketId/tasks/:taskId/done": (config) => {
      record("DONE")(config);
      return [
        200,
        change(store, config.pathParams.taskId, {
          status: "Done",
          isDone: true,
          doneAt: "2026-11-04T10:00:00Z",
          doneBy: WORKER,
          ...finished,
        }),
      ];
    },
    "PUT /api/tickets/:ticketId/tasks/:taskId/reject": (config) => {
      record("REJECT")(config);
      return [
        200,
        change(store, config.pathParams.taskId, {
          status: "Rejected",
          rejectedBy: OTHER,
          rejectedAt: "2026-11-04T10:00:00Z",
          rejectedReason: config.body.reason,
          ...finished,
        }),
      ];
    },
    "PUT /api/tickets/:ticketId/tasks/:taskId/cancel": (config) => {
      record("CANCEL")(config);
      return [
        200,
        change(store, config.pathParams.taskId, {
          status: "Cancelled",
          cancelledBy: WORKER,
          cancelledAt: "2026-11-04T10:00:00Z",
          cancelledReason: config.body.reason,
          ...finished,
        }),
      ];
    },
    "PUT /api/tickets/:ticketId/tasks/:taskId": (config) => {
      record("PUT")(config);
      return [
        200,
        change(store, config.pathParams.taskId, { title: config.body.title }),
      ];
    },
    "DELETE /api/tickets/:ticketId/tasks/:taskId": (config) => {
      record("DELETE")(config);
      store.items = store.items.filter(
        (t) => t.id !== config.pathParams.taskId,
      );
      return [200, { message: "Task removed." }];
    },
    ...routes,
  });
  queryClient.setQueryData(SESSION_KEY, makeUser({ id: viewer }));
  renderWithProviders(
    <Routes>
      <Route path="/tickets/:reference" element={<TicketPage />} />
    </Routes>,
    { route: "/tickets/CP-2026-000001", queryClient },
  );
  return { calls, store };
}

const panel = () => screen.findByTestId("tasks-panel");
const rowOf = async (id) => within(await panel()).findByTestId(`task-${id}`);
const labelled = (label) => (call) => call[0] === label;

describe("Tasks helpers", () => {
  it("blocks resolving with open or rejected tasks unless the code is Duplicate or Raised in error", () => {
    expect(tasksBlockResolve(2, "1")).toBe(true);
    expect(tasksBlockResolve(2, 4)).toBe(false);
    expect(tasksBlockResolve(2, "6")).toBe(false);
    expect(tasksBlockResolve(0, 1)).toBe(false);
    expect(tasksBlockResolve(2, "")).toBe(false);
    expect(blockingTasks({ open: 1, rejected: 2, done: 4, cancelled: 3 })).toBe(
      3,
    );
    expect(openTasksText(1)).toBe(
      "1 task is still open. Mark it done, cancel or remove it first.",
    );
    expect(openTasksText(3)).toBe(
      "3 tasks are still open. Mark them done, cancel or remove them first.",
    );
    expect(formatTaskDue("2026-11-30", Date.parse("2026-11-23"))).toBe(
      "30 Nov",
    );
    expect(formatTaskDue(null)).toBe("");
  });

  it("words the summary, the marker and each outcome", () => {
    expect(tasksSummary({ open: 2, rejected: 1, done: 3, cancelled: 0 })).toBe(
      "2 open, 1 rejected, 3 done",
    );
    expect(tasksSummary({ open: 0, rejected: 0, done: 0, cancelled: 1 })).toBe(
      "1 cancelled",
    );
    expect(tasksSummary({ open: 0, rejected: 0, done: 0, cancelled: 0 })).toBe(
      "",
    );
    expect(tasksMarkerText({ open: 2, rejected: 1 })).toBe(
      "2 tasks open, 1 rejected",
    );
    expect(tasksMarkerText({ open: 1, rejected: 0 })).toBe("1 task open");
    expect(tasksMarkerText({ open: 0, rejected: 2 })).toBe("2 tasks rejected");
    expect(tasksMarkerText({ open: 0, rejected: 0 })).toBe("");
    expect(
      taskOutcomeText(
        task("k", "x", {
          status: "Rejected",
          rejectedBy: OTHER,
          rejectedReason: "Not my area.",
        }),
      ),
    ).toBe("Rejected by Ola Other: Not my area.");
    expect(
      taskOutcomeText(
        task("k", "x", {
          status: "Cancelled",
          cancelledBy: WORKER,
          cancelledReason: "Sorted by phone.",
        }),
      ),
    ).toBe("Cancelled by Chidi Worker: Sorted by phone.");
    expect(
      taskOutcomeText(task("k", "x", { status: "Done", doneBy: OTHER })),
    ).toBe("Done by Ola Other");
    expect(taskOutcomeText(task("k", "x"))).toBe("");
  });
});

describe("Tasks panel", () => {
  it("is not shown to a requester, who never calls the tasks endpoint", async () => {
    const { calls } = renderPage({
      data: ticket({ isStaffView: false, canAddInternalNote: false }),
      viewer: "u-req",
    });
    expect(
      await screen.findByRole("heading", { name: "Conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-panel")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("shows the summary, the tasks in order, owners, due dates, overdue and done", async () => {
    renderPage({
      items: [
        task("k-1", "Ask the employer for the schedule", {
          status: "Done",
          isDone: true,
          doneAt: "2026-11-04T09:00:00Z",
          doneBy: OTHER,
          ...finished,
        }),
        task("k-2", "Post the missing months", {
          assignee: OTHER,
          dueDate: "2026-11-10",
          isOverdue: true,
        }),
        task("k-3", "Check the balance", { dueDate: "2026-12-20" }),
      ],
    });
    const box = await panel();
    const summary = await within(box).findByTestId("tasks-progress");
    expect(summary).toHaveTextContent("2 open, 1 done");
    expect(summary).not.toHaveClass("text-brand-orange-ink");
    expect(within(box).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(
      within(box)
        .getAllByTestId("task-title")
        .map((el) => el.textContent),
    ).toEqual([
      "Ask the employer for the schedule",
      "Post the missing months",
      "Check the balance",
    ]);

    const done = await rowOf("k-1");
    const doneTitle = within(done).getByTestId("task-title");
    expect(doneTitle).toHaveClass("line-through");
    expect(doneTitle).toHaveAttribute(
      "title",
      "Done 4 Nov 2026, 10:00 by Ola Other",
    );
    expect(within(done).getByTestId("task-status")).toHaveTextContent("Done");
    expect(within(done).getByTestId("task-outcome")).toHaveTextContent(
      "Done by Ola Other",
    );
    expect(within(done).queryByRole("button", { name: /^Done:/ })).toBeNull();
    expect(within(done).getByTestId("task-owner")).toHaveTextContent(
      "Ticket assignee",
    );

    const overdue = await rowOf("k-2");
    expect(overdue).toHaveAttribute("data-overdue", "true");
    expect(within(overdue).getByTestId("task-status")).toHaveTextContent(
      "Open",
    );
    expect(within(overdue).getByTestId("task-owner")).toHaveTextContent(
      "Ola Other",
    );
    const due = within(overdue).getByTestId("task-due");
    expect(due).toHaveTextContent("Overdue · due 10 Nov");
    expect(due).toHaveClass("text-danger");

    const later = await rowOf("k-3");
    expect(later).not.toHaveAttribute("data-overdue");
    expect(within(later).getByTestId("task-due")).not.toHaveClass(
      "text-danger",
    );
    expect(within(later).getByTestId("task-due")).not.toHaveTextContent(
      "Overdue",
    );
  });

  it("shows each state's badge and reason: cancelled struck through and grey, rejected in the warning colour", async () => {
    renderPage({
      items: [
        task("k-1", "Call the PFA"),
        task("k-2", "Post the months", {
          status: "Rejected",
          assignee: OTHER,
          rejectedBy: OTHER,
          rejectedAt: "2026-11-04T09:00:00Z",
          rejectedReason: "Not my area, ask Records.",
          canComplete: false,
        }),
        task("k-3", "Write to the employer", {
          status: "Cancelled",
          cancelledBy: WORKER,
          cancelledAt: "2026-11-04T09:00:00Z",
          cancelledReason: "Sorted by phone.",
          ...finished,
        }),
      ],
    });
    const summary = await within(await panel()).findByTestId("tasks-progress");
    expect(summary).toHaveTextContent("1 open, 1 rejected, 1 cancelled");
    expect(summary).toHaveClass("text-brand-orange-ink");

    const rejected = await rowOf("k-2");
    expect(rejected).toHaveAttribute("data-status", "Rejected");
    expect(within(rejected).getByTestId("task-status")).toHaveTextContent(
      "Rejected",
    );
    expect(within(rejected).getByTestId("task-status")).toHaveClass(
      "text-brand-orange-ink",
    );
    const why = within(rejected).getByTestId("task-outcome");
    expect(why).toHaveTextContent(
      "Rejected by Ola Other: Not my area, ask Records.",
    );
    expect(why).toHaveClass("text-brand-orange-ink");
    expect(within(rejected).getByTestId("task-title")).not.toHaveClass(
      "line-through",
    );
    // It can be given to someone else (Edit) or cancelled.
    expect(
      within(rejected).getByRole("button", {
        name: "Edit task: Post the months",
      }),
    ).toBeInTheDocument();

    const cancelled = await rowOf("k-3");
    expect(within(cancelled).getByTestId("task-status")).toHaveTextContent(
      "Cancelled",
    );
    expect(within(cancelled).getByTestId("task-title")).toHaveClass(
      "line-through",
      "text-muted",
    );
    expect(within(cancelled).getByTestId("task-outcome")).toHaveTextContent(
      "Cancelled by Chidi Worker: Sorted by phone.",
    );
    // A cancelled task cannot be edited; Remove stays for one added by mistake.
    expect(
      within(cancelled).queryByRole("button", { name: /Edit task/ }),
    ).toBeNull();
    expect(
      within(cancelled).getByRole("button", {
        name: "Remove task: Write to the employer",
      }),
    ).toBeInTheDocument();
    expect(within(cancelled).queryAllByRole("button")).toHaveLength(1);
  });

  it("shows Done, Reject and Cancel only from the task's flags", async () => {
    renderPage({
      items: [
        task("k-1", "All three", { canReject: true }),
        task("k-2", "Reject only", {
          canComplete: false,
          canReject: true,
          canCancel: false,
        }),
        task("k-3", "None", finished),
      ],
    });
    const names = (row) =>
      within(row)
        .queryAllByRole("button")
        .map((button) => button.textContent)
        .filter((text) => ["Done", "Reject", "Cancel"].includes(text));
    expect(names(await rowOf("k-1"))).toEqual(["Done", "Reject", "Cancel"]);
    expect(names(await rowOf("k-2"))).toEqual(["Reject"]);
    expect(names(await rowOf("k-3"))).toEqual([]);
  });

  it("marks a task done with its Done button", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({ items: [task("k-1", "Call the PFA")] });
    await user.click(
      within(await rowOf("k-1")).getByRole("button", {
        name: "Done: Call the PFA",
      }),
    );
    expect(
      await within(await panel()).findByText("1 done"),
    ).toBeInTheDocument();
    expect(calls.filter(labelled("DONE")).map(([, body]) => body)).toEqual([
      { done: true },
    ]);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("task-k-1")).getByTestId("task-title"),
      ).toHaveAttribute("title", "Done 4 Nov 2026, 11:00 by Chidi Worker"),
    );
  });

  it("Reject asks for at least 5 characters, keeps the API's refusal in the dialog, then sends the reason", async () => {
    const user = userEvent.setup();
    let refuse = true;
    const sent = [];
    renderPage({
      viewer: OTHER.userId,
      items: [
        task("k-1", "Post the months", {
          assignee: OTHER,
          canReject: true,
          canCancel: false,
        }),
      ],
      routes: {
        "PUT /api/tickets/:ticketId/tasks/:taskId/reject": ({ body }) => {
          sent.push(body);
          if (refuse) {
            refuse = false;
            return [
              400,
              {
                message:
                  "Tasks cannot be changed while the ticket is resolved.",
              },
            ];
          }
          return [
            200,
            task("k-1", "Post the months", {
              status: "Rejected",
              rejectedBy: OTHER,
              rejectedReason: body.reason,
              ...finished,
            }),
          ];
        },
      },
    });
    await user.click(
      within(await rowOf("k-1")).getByRole("button", {
        name: "Reject: Post the months",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Reject this task?",
    });
    const box = within(dialog).getByRole("textbox");
    const submit = within(dialog).getByRole("button", { name: "Reject task" });

    await user.type(box, "Nope");
    await user.click(submit);
    expect(
      within(dialog).getByText(
        "Say why you are sending it back (at least 5 characters).",
      ),
    ).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([]);

    await user.type(box, " - not my area");
    await user.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Tasks cannot be changed while the ticket is resolved.",
    );
    expect(
      screen.getByRole("dialog", { name: "Reject this task?" }),
    ).toBeInTheDocument();

    await user.click(submit);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Reject this task?" }),
      ).toBeNull(),
    );
    expect(sent).toEqual([
      { reason: "Nope - not my area" },
      { reason: "Nope - not my area" },
    ]);
  });

  it("Cancel asks for at least 3 characters, sends the reason, and the task shows as cancelled", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({ items: [task("k-1", "Call the PFA")] });
    await user.click(
      within(await rowOf("k-1")).getByRole("button", {
        name: "Cancel task: Call the PFA",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Cancel this task?",
    });
    const submit = within(dialog).getByRole("button", { name: "Cancel task" });
    await user.type(within(dialog).getByRole("textbox"), "no");
    await user.click(submit);
    expect(
      within(dialog).getByText(
        "Say why it is cancelled (at least 3 characters).",
      ),
    ).toBeInTheDocument();
    expect(calls.filter(labelled("CANCEL"))).toEqual([]);

    await user.type(within(dialog).getByRole("textbox"), "t needed");
    await user.click(submit);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("task-k-1")).getByTestId("task-outcome"),
      ).toHaveTextContent("Cancelled by Chidi Worker: not needed"),
    );
    expect(calls.filter(labelled("CANCEL")).map(([, body]) => body)).toEqual([
      { reason: "not needed" },
    ]);
  });

  it("a cancel refused by the API (403) shows its message and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const refusal =
      "Only the ticket's case worker, the person who added the task, the head of the unit or a Super Admin can cancel it.";
    renderPage({
      items: [task("k-1", "Call the PFA")],
      routes: {
        "PUT /api/tickets/:ticketId/tasks/:taskId/cancel": () => [
          403,
          { message: refusal },
        ],
      },
    });
    await user.click(
      within(await rowOf("k-1")).getByRole("button", {
        name: "Cancel task: Call the PFA",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Cancel this task?",
    });
    await user.type(within(dialog).getByRole("textbox"), "Not needed.");
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel task" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(refusal);
    expect(
      screen.getByRole("dialog", { name: "Cancel this task?" }),
    ).toBeInTheDocument();
  });

  it("adds a task with Enter, shows a title error from the API, and sends the owner and date", async () => {
    const user = userEvent.setup();
    let refused = false;
    const sent = [];
    renderPage({
      routes: {
        "POST /api/tickets/:ticketId/tasks": ({ body }) => {
          sent.push(body);
          if (!refused) {
            refused = true;
            return [
              400,
              {
                message: "Describe the task in 3 to 200 characters.",
                errors: { title: "Describe the task in 3 to 200 characters." },
              },
            ];
          }
          return [200, task("k-9", body.title)];
        },
      },
    });
    const form = await within(await panel()).findByTestId("task-add");
    const title = within(form).getByLabelText("Task");
    await user.type(title, "ab{Enter}");
    expect(
      await within(form).findByText(
        "Describe the task in 3 to 200 characters.",
      ),
    ).toBeInTheDocument();
    expect(title).toHaveAttribute("aria-invalid", "true");

    await user.clear(title);
    await user.type(title, "Write to the employer");
    await user.selectOptions(
      within(form).getByLabelText("Owner (optional)"),
      "Ola Other",
    );
    fireEvent.change(within(form).getByLabelText("Due date (optional)"), {
      target: { value: "2026-11-30" },
    });
    await user.type(title, "{Enter}");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { title: "ab", assigneeUserId: null, dueDate: null },
      {
        title: "Write to the employer",
        assigneeUserId: "u-ola",
        dueDate: "2026-11-30",
      },
    ]);
    await waitFor(() => expect(title).toHaveValue(""));
  });

  it("edits a task inline", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({ items: [task("k-1", "Call the PFA")] });
    const row = await rowOf("k-1");
    await user.click(
      within(row).getByRole("button", { name: "Edit task: Call the PFA" }),
    );
    const form = await within(await panel()).findByTestId("task-form-k-1");
    const title = within(form).getByLabelText("Task");
    await user.clear(title);
    await user.type(title, "Call the PFA again");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(
      await within(await panel()).findByText("Call the PFA again"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-form-k-1")).toBeNull();
    expect(calls.find(labelled("PUT"))[1]).toEqual({
      title: "Call the PFA again",
      assigneeUserId: null,
      dueDate: null,
    });
  });

  it("lists the department's people as owners, and keeps a current owner who is not among them", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({
      items: [task("k-1", "Call the PFA", { assignee: LEFT })],
    });
    const options = (form) =>
      within(within(form).getByLabelText("Owner (optional)"))
        .getAllByRole("option")
        .map((option) => option.textContent);
    const add = await within(await panel()).findByTestId("task-add");
    await waitFor(() =>
      expect(options(add)).toEqual([
        "Ticket assignee",
        "Chidi Worker",
        "Ola Other",
      ]),
    );
    await user.click(
      within(await rowOf("k-1")).getByRole("button", {
        name: "Edit task: Call the PFA",
      }),
    );
    const form = await within(await panel()).findByTestId("task-form-k-1");
    expect(options(form)).toEqual([
      "Ticket assignee",
      "Chidi Worker",
      "Ola Other",
      "Lola Left",
    ]);
    expect(within(form).getByLabelText("Owner (optional)")).toHaveValue(
      "u-left",
    );
    expect(calls.filter(labelled("OWNERS"))).toHaveLength(1);
  });

  it("says when a task was done; no name when the API gives none", async () => {
    renderPage({
      items: [
        task("k-1", "Call the PFA"),
        task("k-2", "Old task", {
          status: "Done",
          isDone: true,
          doneAt: "2026-11-24T09:00:00Z",
          ...finished,
        }),
      ],
    });
    const old = within(await rowOf("k-2")).getByTestId("task-title");
    expect(old).toHaveAttribute("title", "Done 24 Nov 2026, 10:00");
    expect(
      within(await rowOf("k-2")).getByTestId("task-outcome"),
    ).toHaveTextContent(/^Done$/);
    const open = within(await rowOf("k-1")).getByTestId("task-title");
    expect(open).not.toHaveAttribute("title");
  });

  it("removes a task after confirming", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({
      items: [task("k-1", "Call the PFA"), task("k-2", "Post it")],
    });
    const row = await rowOf("k-1");
    await user.click(
      within(row).getByRole("button", { name: "Remove task: Call the PFA" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Remove this task?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(screen.queryByTestId("task-k-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("task-k-2")).toBeInTheDocument();
    expect(calls.filter(labelled("DELETE"))).toHaveLength(1);
  });

  it("is read only with the reason once the ticket is resolved", async () => {
    renderPage({
      data: ticket({ status: 5, resolvedAt: "2026-11-04T10:00:00Z" }),
      items: [task("k-1", "Call the PFA", finished)],
      canEdit: false,
    });
    const box = await panel();
    expect(await within(box).findByTestId("tasks-locked")).toHaveTextContent(
      "Tasks cannot be changed while the ticket is resolved.",
    );
    expect(within(box).queryAllByRole("button")).toHaveLength(0);
    expect(within(box).queryByTestId("task-add")).toBeNull();
  });
});

describe("A task owner from another unit", () => {
  const outsider = ticket({ isStaffView: false, canAddInternalNote: false });

  it("sees only their own task, can finish or reject it, and cannot add, edit or remove", async () => {
    const { calls } = renderPage({
      data: outsider,
      viewer: OTHER.userId,
      canEdit: false,
      items: [
        task("k-2", "Check the Records file", {
          assignee: OTHER,
          canComplete: true,
          canReject: true,
          canCancel: false,
        }),
      ],
    });
    const box = await panel();
    const row = await rowOf("k-2");
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Done", "Reject"]);
    expect(within(box).queryByTestId("task-add")).toBeNull();
    expect(within(box).queryByTestId("tasks-locked")).toBeNull();
    expect(within(box).queryByRole("button", { name: /Edit task/ })).toBeNull();
    // Staff-only parts stay away: no owners list, no Actions card, no marker.
    expect(calls.filter(labelled("OWNERS"))).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
    expect(screen.queryByTestId("tasks-marker")).toBeNull();
  });

  it("someone with no task (the tasks endpoint answers 404) gets no panel", async () => {
    const { calls } = renderPage({
      data: outsider,
      viewer: "u-copied",
      routes: {
        "GET /api/tickets/:ticketId/tasks": (config) => {
          calls.push(["GET", null, config.pathParams]);
          return [404, { message: "Ticket not found." }];
        },
      },
    });
    await waitFor(() => expect(calls.filter(labelled("GET"))).toHaveLength(1));
    expect(
      await screen.findByRole("heading", { name: "Conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-panel")).toBeNull();
    expect(screen.queryByTestId("tasks-error")).toBeNull();
  });
});

describe("Ticket page task marker", () => {
  it('says "2 tasks open, 1 rejected" in the warning colour and moves to the tasks panel', async () => {
    const user = userEvent.setup();
    renderPage({
      items: [
        task("k-1", "One"),
        task("k-2", "Two"),
        task("k-3", "Three", {
          status: "Rejected",
          rejectedBy: OTHER,
          rejectedReason: "Not mine.",
        }),
        task("k-4", "Four", { status: "Done", isDone: true, ...finished }),
      ],
    });
    const marker = await screen.findByTestId("tasks-marker");
    expect(marker).toHaveTextContent("2 tasks open, 1 rejected");
    expect(marker).toHaveClass("text-brand-orange-ink");
    expect(marker).toHaveAttribute("href", "#ticket-tasks");
    await user.click(marker);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("tasks-panel")),
    );
  });

  it("is plain navy with only open tasks, and absent when nothing blocks resolving", async () => {
    renderPage({ items: [task("k-1", "One")] });
    const marker = await screen.findByTestId("tasks-marker");
    expect(marker).toHaveTextContent("1 task open");
    expect(marker).not.toHaveClass("text-brand-orange-ink");
  });

  it("does not show for done and cancelled tasks only", async () => {
    renderPage({
      items: [
        task("k-1", "One", { status: "Done", isDone: true, ...finished }),
        task("k-2", "Two", { status: "Cancelled", ...finished }),
      ],
    });
    await within(await panel()).findByText("1 done, 1 cancelled");
    expect(screen.queryByTestId("tasks-marker")).toBeNull();
  });
});

describe("Resolve with open tasks", () => {
  it("blocks Resolve while tasks are open, unless the code is Duplicate or Raised in error", async () => {
    const user = userEvent.setup();
    const sent = [];
    renderPage({
      items: [task("k-1", "Call the PFA"), task("k-2", "Post it")],
      flags: actions({ canResolve: true }),
      routes: {
        "POST /api/tickets/:ticketId/resolve": ({ body }) => {
          sent.push(body);
          return [200, { message: "Resolved." }];
        },
      },
    });
    await within(await panel()).findByText("2 open");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog", { name: "Resolve" });
    const select = within(dialog).getByLabelText("Resolution code");
    const submit = within(dialog).getByRole("button", { name: "Resolve" });

    await user.selectOptions(select, "Completed");
    expect(within(dialog).getByTestId("resolve-open-tasks")).toHaveTextContent(
      "2 tasks are still open. Mark them done, cancel or remove them first.",
    );
    expect(
      within(dialog).getByRole("link", { name: "Go to the tasks" }),
    ).toHaveAttribute("href", "#ticket-tasks");
    expect(submit).toBeDisabled();

    await user.selectOptions(select, "Duplicate");
    expect(within(dialog).queryByTestId("resolve-open-tasks")).toBeNull();
    expect(submit).toBeEnabled();
    await user.selectOptions(select, "Raised in error");
    expect(submit).toBeEnabled();
    await user.type(within(dialog).getByRole("textbox"), "Raised by mistake.");
    await user.click(submit);
    await waitFor(() =>
      expect(sent).toEqual([{ code: 6, note: "Raised by mistake." }]),
    );
  });

  it("a rejected task still blocks Resolve; a cancelled one does not", async () => {
    const user = userEvent.setup();
    renderPage({
      items: [
        task("k-1", "Post it", {
          status: "Rejected",
          rejectedBy: OTHER,
          rejectedReason: "Not mine.",
        }),
        task("k-2", "Old idea", { status: "Cancelled", ...finished }),
      ],
      flags: actions({ canResolve: true }),
    });
    await within(await panel()).findByText("1 rejected, 1 cancelled");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog", { name: "Resolve" });
    await user.selectOptions(
      within(dialog).getByLabelText("Resolution code"),
      "Completed",
    );
    expect(within(dialog).getByTestId("resolve-open-tasks")).toHaveTextContent(
      "1 task is still open. Mark it done, cancel or remove it first.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Resolve" }),
    ).toBeDisabled();
  });

  it("shows the API's errors.tasks as given, and refreshes the counts", async () => {
    const user = userEvent.setup();
    const message =
      "1 task is still open. Mark it done, cancel or remove it first.";
    const { calls } = renderPage({
      flags: actions({ canResolve: true }),
      routes: {
        "POST /api/tickets/:ticketId/resolve": () => [
          400,
          { message, errors: { tasks: message } },
        ],
      },
    });
    await within(await panel()).findByText("No tasks yet.");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog", { name: "Resolve" });
    await user.selectOptions(
      within(dialog).getByLabelText("Resolution code"),
      "Completed",
    );
    await user.type(within(dialog).getByRole("textbox"), "All done now.");
    const before = calls.filter(labelled("GET")).length;
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(
      await within(dialog).findByTestId("resolve-open-tasks"),
    ).toHaveTextContent(message);
    await waitFor(() =>
      expect(calls.filter(labelled("GET")).length).toBe(before + 1),
    );
  });
});
