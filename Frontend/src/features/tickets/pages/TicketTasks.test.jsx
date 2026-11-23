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
import { formatTaskDue, openTasksText, tasksBlockResolve } from "../tasks.js";
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

const task = (id, title, overrides = {}) => ({
  id,
  title,
  assignee: null,
  dueDate: null,
  isDone: false,
  doneAt: null,
  doneBy: null,
  isOverdue: false,
  createdAt: "2026-11-03T10:00:00Z",
  ...overrides,
});

const tasksOf = (items, canEdit = true) => ({
  items,
  open: items.filter((t) => !t.isDone).length,
  done: items.filter((t) => t.isDone).length,
  canEdit,
});

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
      store.items = store.items.map((t) =>
        t.id === config.pathParams.taskId
          ? {
              ...t,
              isDone: config.body.done,
              doneAt: config.body.done ? "2026-11-04T10:00:00Z" : null,
              doneBy: config.body.done ? WORKER : null,
            }
          : t,
      );
      return [200, store.items.find((t) => t.id === config.pathParams.taskId)];
    },
    "PUT /api/tickets/:ticketId/tasks/:taskId": (config) => {
      record("PUT")(config);
      store.items = store.items.map((t) =>
        t.id === config.pathParams.taskId
          ? { ...t, title: config.body.title }
          : t,
      );
      return [200, store.items.find((t) => t.id === config.pathParams.taskId)];
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

describe("Tasks helpers", () => {
  it("blocks resolving with open tasks unless the code is Duplicate or Raised in error", () => {
    expect(tasksBlockResolve(2, "1")).toBe(true);
    expect(tasksBlockResolve(2, 4)).toBe(false);
    expect(tasksBlockResolve(2, "6")).toBe(false);
    expect(tasksBlockResolve(0, 1)).toBe(false);
    expect(tasksBlockResolve(2, "")).toBe(false);
    expect(openTasksText(1)).toBe(
      "1 task is still open. Mark it done or remove it first.",
    );
    expect(openTasksText(3)).toBe(
      "3 tasks are still open. Mark them done or remove them first.",
    );
    expect(formatTaskDue("2026-11-30", Date.parse("2026-11-23"))).toBe(
      "30 Nov",
    );
    expect(formatTaskDue(null)).toBe("");
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

  it("shows the progress, the tasks in order, owners, due dates, overdue and done", async () => {
    renderPage({
      items: [
        task("k-1", "Ask the employer for the schedule", {
          isDone: true,
          doneAt: "2026-11-04T09:00:00Z",
          doneBy: OTHER,
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
    expect(await within(box).findByTestId("tasks-progress")).toHaveTextContent(
      "1 of 3 done",
    );
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
    expect(within(done).getByRole("checkbox")).toBeChecked();
    expect(within(done).getByTestId("task-owner")).toHaveTextContent(
      "Ticket assignee",
    );

    const overdue = await rowOf("k-2");
    expect(overdue).toHaveAttribute("data-overdue", "true");
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

  it("ticks and unticks a task", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({ items: [task("k-1", "Call the PFA")] });
    const row = await rowOf("k-1");
    await user.click(
      within(row).getByRole("checkbox", { name: "Mark done: Call the PFA" }),
    );
    expect(
      await within(await panel()).findByText("1 of 1 done"),
    ).toBeInTheDocument();
    const box = await rowOf("k-1");
    await user.click(
      within(box).getByRole("checkbox", {
        name: "Mark not done: Call the PFA",
      }),
    );
    expect(
      await within(await panel()).findByText("0 of 1 done"),
    ).toBeInTheDocument();
    expect(
      calls.filter(([label]) => label === "DONE").map(([, body]) => body),
    ).toEqual([{ done: true }, { done: false }]);
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
    expect(calls.find(([label]) => label === "PUT")[1]).toEqual({
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
    expect(calls.filter(([label]) => label === "OWNERS")).toHaveLength(1);
  });

  it("says who ticked a task and when; no name when the API gives none", async () => {
    const user = userEvent.setup();
    renderPage({
      items: [
        task("k-1", "Call the PFA"),
        task("k-2", "Old task", {
          isDone: true,
          doneAt: "2026-11-24T09:00:00Z",
        }),
      ],
    });
    const old = within(await rowOf("k-2")).getByTestId("task-title");
    expect(old).toHaveAttribute("title", "Done 24 Nov 2026, 10:00");
    const open = within(await rowOf("k-1")).getByTestId("task-title");
    expect(open).not.toHaveAttribute("title");
    await user.click(within(await rowOf("k-1")).getByRole("checkbox"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("task-k-1")).getByTestId("task-title"),
      ).toHaveAttribute("title", "Done 4 Nov 2026, 11:00 by Chidi Worker"),
    );
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
    expect(calls.filter(([label]) => label === "DELETE")).toHaveLength(1);
  });

  it("is read only with the reason once the ticket is resolved", async () => {
    renderPage({
      data: ticket({ status: 5, resolvedAt: "2026-11-04T10:00:00Z" }),
      items: [task("k-1", "Call the PFA")],
      canEdit: false,
    });
    const box = await panel();
    expect(await within(box).findByTestId("tasks-locked")).toHaveTextContent(
      "Tasks cannot be changed while the ticket is resolved.",
    );
    expect(within(box).getByRole("checkbox")).toBeDisabled();
    expect(within(box).queryByTestId("task-add")).toBeNull();
    expect(within(box).queryByRole("button", { name: /Edit task/ })).toBeNull();
    expect(
      within(box).queryByRole("button", { name: /Remove task/ }),
    ).toBeNull();
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
    await within(await panel()).findByText("0 of 2 done");
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog", { name: "Resolve" });
    const select = within(dialog).getByLabelText("Resolution code");
    const submit = within(dialog).getByRole("button", { name: "Resolve" });

    await user.selectOptions(select, "Completed");
    expect(within(dialog).getByTestId("resolve-open-tasks")).toHaveTextContent(
      "2 tasks are still open. Mark them done or remove them first.",
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

  it("shows the API's errors.tasks, and refreshes the open count", async () => {
    const user = userEvent.setup();
    const { calls } = renderPage({
      flags: actions({ canResolve: true }),
      routes: {
        "POST /api/tickets/:ticketId/resolve": () => [
          400,
          {
            message: "1 task is still open. Mark it done or remove it first.",
            errors: {
              tasks: "1 task is still open. Mark it done or remove it first.",
            },
          },
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
    const before = calls.filter(([label]) => label === "GET").length;
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(
      await within(dialog).findByTestId("resolve-open-tasks"),
    ).toHaveTextContent(
      "1 task is still open. Mark it done or remove it first.",
    );
    await waitFor(() =>
      expect(calls.filter(([label]) => label === "GET").length).toBe(
        before + 1,
      ),
    );
  });
});
