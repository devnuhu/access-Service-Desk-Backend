import { useRef, useState } from "react";
import { CircleAlert, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import {
  Button,
  Card,
  ConfirmDialog,
  InlineRetry,
  Spinner,
  useToast,
} from "@/shared/ui";
import { STATUS_LABELS } from "../api/endpoints.js";
import {
  useAddTask,
  useRemoveTask,
  useSetTaskDone,
  useTaskOwners,
  useTicketTasks,
  useUpdateTask,
} from "../hooks/useTasks.js";
import { doneText, formatTaskDue, TASKS_PANEL_ID } from "../tasks.js";
import { personName } from "../ticketText.js";

const FIELDS = ["title", "assigneeUserId", "dueDate"];

/**
 * Who can own a task: everyone in the ticket's department (tasks/owners), plus the task's current
 * owner when they are no longer in it, so editing never drops them. Empty value: the ticket's assignee.
 */
function useOwnerChoices(ticketId, current) {
  const owners = useTaskOwners(ticketId);
  const seen = new Set();
  const people = [];
  for (const person of [...(owners.data ?? []), current]) {
    if (!person || seen.has(person.userId)) continue;
    seen.add(person.userId);
    people.push(person);
  }
  return people;
}

/** Title, owner and due date: adds a task, or (with `task`) edits it inline. Enter submits. */
function TaskForm({ ticketId, task, onDone, onCancel }) {
  const toast = useToast();
  const add = useAddTask(ticketId);
  const update = useUpdateTask(ticketId);
  const [title, setTitle] = useState(task?.title ?? "");
  const [owner, setOwner] = useState(task?.assignee?.userId ?? "");
  const [due, setDue] = useState(task?.dueDate ?? "");
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const titleRef = useRef(null);
  const people = useOwnerChoices(ticketId, task?.assignee);
  const prefix = task ? `task-${task.id}` : "task-new";
  const busy = add.isPending || update.isPending;

  const submit = async (event) => {
    event.preventDefault();
    setFailure(null);
    if (!title.trim()) {
      setErrors({ title: "Describe the task." });
      titleRef.current?.focus();
      return;
    }
    setErrors({});
    const body = {
      title: title.trim(),
      assigneeUserId: owner || null,
      dueDate: due || null,
    };
    try {
      if (task) await update.mutateAsync({ taskId: task.id, body });
      else await add.mutateAsync(body);
      if (task) {
        onDone?.();
        return;
      }
      setTitle("");
      setOwner("");
      setDue("");
      titleRef.current?.focus();
    } catch (error) {
      const found = Object.fromEntries(
        FIELDS.map((field) => [field, fieldError(error, field)]).filter(
          ([, message]) => message,
        ),
      );
      setErrors(found);
      if (!Object.keys(found).length) {
        if (task) toast.error(error.message);
        else setFailure(error.message);
      }
    }
  };

  const input = (field) =>
    `h-11 w-full rounded-lg border bg-white px-3 text-sm text-ink ${errors[field] ? "border-danger" : "border-line"}`;
  const describedBy = (field) =>
    errors[field] ? `${prefix}-${field}-error` : undefined;
  const error = (field) =>
    errors[field] && (
      <p
        id={`${prefix}-${field}-error`}
        className="mt-1 text-xs font-medium text-danger"
      >
        {errors[field]}
      </p>
    );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={task ? `Edit task: ${task.title}` : "Add a task"}
      data-testid={task ? `task-form-${task.id}` : "task-add"}
      className="space-y-2"
    >
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <div className="min-w-0">
          <label
            htmlFor={`${prefix}-title`}
            className={
              task ? "sr-only" : "block text-xs font-semibold text-muted"
            }
          >
            Task
          </label>
          <input
            ref={titleRef}
            id={`${prefix}-title`}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((e) => ({ ...e, title: undefined }));
            }}
            maxLength={200}
            autoFocus={Boolean(task)}
            autoComplete="off"
            placeholder={task ? undefined : "What needs doing?"}
            aria-invalid={errors.title ? "true" : undefined}
            aria-describedby={describedBy("title")}
            className={input("title")}
          />
          {error("title")}
        </div>
        <div className="min-w-0">
          <label
            htmlFor={`${prefix}-owner`}
            className={
              task ? "sr-only" : "block text-xs font-semibold text-muted"
            }
          >
            Owner (optional)
          </label>
          <select
            id={`${prefix}-owner`}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            aria-invalid={errors.assigneeUserId ? "true" : undefined}
            aria-describedby={describedBy("assigneeUserId")}
            className={input("assigneeUserId")}
          >
            <option value="">Ticket assignee</option>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {personName(person)}
              </option>
            ))}
          </select>
          {error("assigneeUserId")}
        </div>
        <div className="min-w-0">
          <label
            htmlFor={`${prefix}-due`}
            className={
              task ? "sr-only" : "block text-xs font-semibold text-muted"
            }
          >
            Due date (optional)
          </label>
          <input
            id={`${prefix}-due`}
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            aria-invalid={errors.dueDate ? "true" : undefined}
            aria-describedby={describedBy("dueDate")}
            className={input("dueDate")}
          />
          {error("dueDate")}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy} className="min-h-11">
          {task ? (
            "Save"
          ) : (
            <>
              <Plus aria-hidden="true" size={16} />
              Add task
            </>
          )}
        </Button>
        {task && (
          <Button variant="secondary" onClick={onCancel} className="min-h-11">
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function TaskRow({ ticketId, task, canEdit, onRemove }) {
  const toast = useToast();
  const setDone = useSetTaskDone(ticketId);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li data-testid={`task-${task.id}`} className="py-3">
        <TaskForm
          ticketId={ticketId}
          task={task}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const toggle = async () => {
    try {
      await setDone.mutateAsync({ taskId: task.id, done: !task.isDone });
    } catch (error) {
      toast.error(error.message);
    }
  };
  const due = formatTaskDue(task.dueDate);

  return (
    <li
      data-testid={`task-${task.id}`}
      data-overdue={task.isOverdue ? "true" : undefined}
      className="flex items-start gap-1 py-1.5"
    >
      <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={task.isDone}
          disabled={!canEdit || setDone.isPending}
          onChange={toggle}
          className="h-5 w-5 accent-brand-navy disabled:cursor-not-allowed"
        />
        <span className="sr-only">
          {task.isDone ? "Mark not done: " : "Mark done: "}
          {task.title}
        </span>
      </label>
      <div className="min-w-0 flex-1 py-2.5">
        <p
          data-testid="task-title"
          title={task.isDone ? doneText(task) || undefined : undefined}
          className={`text-sm break-words ${task.isDone ? "text-muted line-through" : "text-ink"}`}
        >
          {task.title}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
          <span data-testid="task-owner">
            {task.assignee ? personName(task.assignee) : "Ticket assignee"}
          </span>
          {due && (
            <span
              data-testid="task-due"
              className={
                task.isOverdue
                  ? "inline-flex items-center gap-1 font-semibold text-danger"
                  : ""
              }
            >
              {task.isOverdue && <CircleAlert aria-hidden="true" size={12} />}
              {task.isOverdue ? `Overdue · due ${due}` : `Due ${due}`}
            </span>
          )}
        </p>
      </div>
      {canEdit && (
        <span className="flex shrink-0">
          <button
            type="button"
            aria-label={`Edit task: ${task.title}`}
            onClick={() => setEditing(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-page hover:text-ink"
          >
            <Pencil aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Remove task: ${task.title}`}
            onClick={() => onRemove(task)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-light hover:text-danger"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * The ticket's checklist (staff view only: never render it for a requester, who would get 404).
 * "2 of 4 done" with a bar, the tasks in the order added, and "Add a task". Once the ticket is
 * Resolved, Closed or Cancelled (canEdit false) everything is read only, with the reason.
 */
export default function TasksPanel({ ticket }) {
  const toast = useToast();
  const tasks = useTicketTasks(ticket.id);
  const remove = useRemoveTask(ticket.id);
  const [removing, setRemoving] = useState(null);
  const data = tasks.data;
  const total = data ? data.open + data.done : 0;

  const confirmRemove = async () => {
    try {
      const result = await remove.mutateAsync(removing.id);
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card
      id={TASKS_PANEL_ID}
      tabIndex={-1}
      className="scroll-mt-4 p-5 focus:outline-none"
      aria-labelledby="tasks-heading"
      data-testid="tasks-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tasks-heading" className="text-base font-semibold">
          Tasks
        </h2>
        {data && total > 0 && (
          <span data-testid="tasks-progress" className="text-sm text-body">
            {data.done} of {total} done
          </span>
        )}
      </div>
      {data && total > 0 && (
        <div
          role="progressbar"
          aria-label="Tasks done"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={data.done}
          aria-valuetext={`${data.done} of ${total} done`}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-brand-navy"
            style={{ width: `${(data.done / total) * 100}%` }}
          />
        </div>
      )}

      {tasks.isLoading ? (
        <div className="mt-3">
          <Spinner label="Loading tasks…" />
        </div>
      ) : tasks.isError ? (
        <div className="mt-3">
          <InlineRetry
            testId="tasks-error"
            message={tasks.error.message}
            onRetry={() => tasks.refetch()}
          />
        </div>
      ) : (
        <>
          {!data.canEdit && (
            <p
              data-testid="tasks-locked"
              className="mt-3 flex items-center gap-1.5 text-sm text-muted"
            >
              <Lock aria-hidden="true" size={14} />
              Tasks cannot be changed while the ticket is{" "}
              {(STATUS_LABELS[ticket.status] ?? "finished").toLowerCase()}.
            </p>
          )}
          {data.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No tasks yet.</p>
          ) : (
            <ul
              aria-label="Tasks"
              className="mt-2 divide-y divide-line"
              data-testid="tasks-list"
            >
              {data.items.map((task) => (
                <TaskRow
                  key={task.id}
                  ticketId={ticket.id}
                  task={task}
                  canEdit={data.canEdit}
                  onRemove={setRemoving}
                />
              ))}
            </ul>
          )}
          {data.canEdit && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold">Add a task</h3>
              <TaskForm ticketId={ticket.id} />
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this task?"
        message={removing ? `“${removing.title}” goes from the checklist.` : ""}
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
