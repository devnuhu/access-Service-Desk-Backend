import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { fieldError } from "@/shared/lib/http";
import { LIST_PAGE_SIZE } from "@/shared/lib/paging";
import { formatWatDateTime } from "@/shared/lib/time";
import { Button, InlineRetry, Pager, Spinner } from "@/shared/ui";
import { MY_TASK_DATE, MY_TASK_STATUS } from "../api/endpoints.js";
import { useMyTasks } from "../hooks/useTasks.js";
import { formatTaskDue } from "../tasks.js";
import { personName } from "../ticketText.js";
import { TaskStatusChip } from "./TasksPanel.jsx";

const CHIPS = [
  [MY_TASK_STATUS.Open, "Open"],
  [MY_TASK_STATUS.Done, "Done"],
  [MY_TASK_STATUS.Rejected, "Rejected"],
  [MY_TASK_STATUS.Cancelled, "Cancelled"],
  [MY_TASK_STATUS.All, "All"],
];

const DATE_FIELDS = [
  [MY_TASK_DATE.Given, "Given"],
  [MY_TASK_DATE.Due, "Due"],
  [MY_TASK_DATE.Finished, "Finished"],
];

const EMPTY = {
  [MY_TASK_STATUS.Open]: "No tasks are waiting for you.",
  [MY_TASK_STATUS.Done]: "No done tasks.",
  [MY_TASK_STATUS.Rejected]: "No rejected tasks.",
  [MY_TASK_STATUS.Cancelled]: "No cancelled tasks.",
  [MY_TASK_STATUS.All]: "No tasks.",
};

const input =
  "h-10 rounded-lg border bg-white px-3 text-sm text-ink border-line aria-invalid:border-danger";

function DueCell({ task }) {
  const due = formatTaskDue(task.dueDate);
  if (task.status !== "Open")
    return <span className="text-body">{due || "—"}</span>;
  if (task.isOverdue)
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-danger">
        <CircleAlert aria-hidden="true" size={12} />
        Overdue{due ? ` · ${due}` : ""}
      </span>
    );
  return due ? (
    <span className="text-body">Due {due}</span>
  ) : (
    <span className="text-muted">No due date</span>
  );
}

/**
 * The Work queue's "My tasks" tab: tasks given to me on any ticket (GET /api/tasks/mine), soonest
 * due first, 10 a page. Nothing leaves the list once done, rejected or cancelled: the status chips
 * (with the server's counts inside the date window) choose which. The date window (Given, Due or
 * Finished, From and To, both included) applies to the list and the counts. Rows that are not open
 * show when they finished and the reason; open rows keep the due date and Overdue. A row opens its
 * ticket.
 */
export default function MyTasksPanel() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(MY_TASK_STATUS.Open);
  const [dateField, setDateField] = useState(MY_TASK_DATE.Given);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dated = Boolean(from || to);
  const paging = usePaging(`${status}|${dateField}|${from}|${to}`);
  const { page, setPage } = paging;
  const list = useMyTasks({
    status,
    // The date type matters only with a window; leave the default off the address otherwise.
    dateField: dated ? dateField : undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, list.data?.total);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const counts = list.data?.counts;
  const showFinished = status !== MY_TASK_STATUS.Open;
  const errors = {
    from: list.error && fieldError(list.error, "from"),
    to: list.error && fieldError(list.error, "to"),
    dateField: list.error && fieldError(list.error, "dateField"),
  };
  const fieldProblem = errors.from || errors.to || errors.dateField;
  const clear = () => {
    setFrom("");
    setTo("");
    setDateField(MY_TASK_DATE.Given);
  };

  return (
    <div data-testid="my-tasks">
      <div className="space-y-3 border-b border-line px-5 py-3">
        <div
          role="group"
          aria-label="Task status"
          className="flex flex-wrap gap-2"
        >
          {CHIPS.map(([value, label]) => {
            const on = status === value;
            const count = counts?.[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                data-testid={`my-tasks-chip-${value}`}
                onClick={() => setStatus(value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${on ? "border-brand-navy bg-brand-navy text-white" : "border-line bg-white text-body hover:border-brand-navy"}`}
              >
                {label}
                {count != null && (
                  <span
                    className={`tabular-nums ${on ? "text-white/80" : "text-muted"}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Date
            <select
              value={dateField}
              onChange={(event) => setDateField(event.target.value)}
              aria-invalid={errors.dateField ? "true" : undefined}
              className={input}
            >
              {DATE_FIELDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              aria-invalid={errors.from ? "true" : undefined}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={errors.to ? "true" : undefined}
              className={input}
            />
          </label>
          <Button
            variant="secondary"
            onClick={clear}
            disabled={!dated && dateField === MY_TASK_DATE.Given}
          >
            Clear
          </Button>
        </div>
        {fieldProblem && (
          <p role="alert" className="text-sm font-medium text-danger">
            {fieldProblem}
          </p>
        )}
      </div>

      {list.isLoading ? (
        <div className="px-5 py-10 text-center">
          <Spinner label="Loading your tasks…" />
        </div>
      ) : list.isError && !list.data ? (
        fieldProblem ? null : (
          <div className="px-5 py-6">
            <InlineRetry
              testId="my-tasks-error"
              message={list.error.message}
              onRetry={() => list.refetch()}
            />
          </div>
        )
      ) : items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          {dated ? "No tasks in these dates." : EMPTY[status]}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table
              aria-label="My tasks"
              className={`w-full text-sm ${list.isPlaceholderData ? "opacity-60" : ""}`}
            >
              <thead className="border-b border-line bg-page/60 text-left text-[12px] font-semibold tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-2.5">
                    Task
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Given by
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Due
                  </th>
                  {showFinished && (
                    <>
                      <th scope="col" className="px-3 py-2.5">
                        Finished
                      </th>
                      <th scope="col" className="px-3 py-2.5">
                        Reason
                      </th>
                    </>
                  )}
                  <th scope="col" className="px-3 py-2.5">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((task) => {
                  const href = `/tickets/${task.ticketReference}`;
                  const open = task.status === "Open";
                  return (
                    <tr
                      key={task.taskId}
                      data-testid={`my-task-${task.taskId}`}
                      onClick={() => navigate(href)}
                      className="cursor-pointer align-top hover:bg-page"
                    >
                      <td className="min-w-56 px-5 py-3">
                        <Link
                          to={href}
                          onClick={(event) => event.stopPropagation()}
                          className="block font-semibold break-words text-ink hover:underline"
                        >
                          {task.title}
                        </Link>
                        <span className="block text-xs break-words text-muted">
                          <span className="font-semibold text-brand-navy">
                            {task.ticketReference}
                          </span>{" "}
                          · {task.ticketSubject}
                        </span>
                      </td>
                      <td
                        data-testid="my-task-given-by"
                        className="px-3 py-3 text-xs whitespace-nowrap text-body"
                      >
                        {task.givenBy ? personName(task.givenBy) : "—"}
                      </td>
                      <td
                        data-testid="my-task-due"
                        className="px-3 py-3 text-xs whitespace-nowrap"
                      >
                        <DueCell task={task} />
                      </td>
                      {showFinished && (
                        <>
                          <td
                            data-testid="my-task-finished"
                            className="px-3 py-3 text-xs whitespace-nowrap text-body"
                          >
                            {!open && task.finishedAt
                              ? formatWatDateTime(task.finishedAt)
                              : "—"}
                          </td>
                          <td
                            data-testid="my-task-reason"
                            className="max-w-64 px-3 py-3 text-xs break-words whitespace-pre-line text-body"
                          >
                            {!open && task.reason ? task.reason : "—"}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-3">
                        <TaskStatusChip status={task.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-5 py-3">
            <Pager
              total={total}
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
