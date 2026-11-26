import { useRef, useState } from "react";
import { CircleAlert, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  InlineRetry,
  Spinner,
  useToast,
} from "@/shared/ui";
import { STATUS_LABELS, TASK_STATUS } from "../api/endpoints.js";
import {
  useAddTask,
  useCancelTask,
  useRejectTask,
  useRemoveTask,
  useSetTaskDone,
  useTaskOwners,
  useTicketTasks,
  useUpdateTask,
} from "../hooks/useTasks.js";
import {
  doneText,
  formatTaskDue,
  TASKS_PANEL_ID,
  taskOutcomeText,
  tasksSummary,
} from "../tasks.js";
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

/** A task's state as a chip: Rejected in the warning colour, Cancelled greyed. */
const STATUS_TONES = {
  [TASK_STATUS.Open]: "navy",
  [TASK_STATUS.Done]: "green",
  [TASK_STATUS.Rejected]: "orange",
  [TASK_STATUS.Cancelled]: "grey",
};

export function TaskStatusChip({ status, handedOver = false }) {
  return (
    <Chip
      tone={handedOver ? "grey" : (STATUS_TONES[status] ?? "grey")}
      data-testid="task-status"
    >
      {handedOver ? "Handed over" : status}
    </Chip>
  );
}

/** Reject and Cancel: say why. The length is checked here too; the API's refusal stays in the dialog. */
const REASONS = {
  reject: {
    title: "Reject this task?",
    label:
      "Why are you sending it back? The case worker and whoever added it see this.",
    submit: "Reject task",
    min: 5,
    tooShort: "Say why you are sending it back (at least 5 characters).",
    done: "Task rejected.",
  },
  cancel: {
    title: "Cancel this task?",
    label: "Why is it no longer needed? Its owner sees this.",
    submit: "Cancel task",
    min: 3,
    tooShort: "Say why it is cancelled (at least 3 characters).",
    done: "Task cancelled.",
  },
};
const REASON_MAX = 500;

function TaskReasonDialog({ ticketId, task, kind, onClose }) {
  const toast = useToast();
  const reject = useRejectTask(ticketId);
  const cancel = useCancelTask(ticketId);
  const mutation = kind === "reject" ? reject : cancel;
  const text = REASONS[kind];
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const formId = `task-${kind}-${task.id}`;
  const length = reason.trim().length;

  const save = async (event) => {
    event.preventDefault();
    setFailure(null);
    if (length < text.min) {
      setError(text.tooShort);
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ taskId: task.id, reason: reason.trim() });
      toast.success(text.done);
      onClose();
    } catch (problem) {
      const field = fieldError(problem, "reason");
      if (field) setError(field);
      else setFailure(problem.message);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={text.title}
      description={`“${task.title}”`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            busy={mutation.isPending}
          >
            {text.submit}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="space-y-4">
        {failure && (
          <p
            role="alert"
            className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {failure}
          </p>
        )}
        <div>
          <label
            htmlFor={`${formId}-reason`}
            className="block text-sm font-semibold text-ink"
          >
            {text.label}
          </label>
          <textarea
            id={`${formId}-reason`}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={`${formId}-count${error ? ` ${formId}-error` : ""}`}
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
          />
          <p
            id={`${formId}-count`}
            className={`text-right text-xs ${length > REASON_MAX ? "font-medium text-danger" : "text-muted"}`}
          >
            {length} of {REASON_MAX} characters
          </p>
          {error && (
            <p
              id={`${formId}-error`}
              className="mt-1 text-xs font-medium text-danger"
            >
              {error}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * One task: its state, owner, due date and outcome ("Rejected by …: reason"), and the buttons the
 * API allows for it (canComplete, canReject, canCancel, canRemove), never decided from the role.
 * Edit is for staff (canEdit); a cancelled task cannot be edited, and editing a rejected one with
 * another owner makes a new task (the list refetches after saving). Remove (canRemove: a task added
 * by mistake, unowned or one's own) is not Cancel, which drops someone else's task with a reason.
 * A handed-over task (rejected, then given to someone else) is history: no buttons at all.
 */
function TaskRow({ ticketId, task, canEdit, onRemove }) {
  const toast = useToast();
  const setDone = useSetTaskDone(ticketId);
  const [editing, setEditing] = useState(false);
  const [reasonFor, setReasonFor] = useState(null);

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

  const complete = async () => {
    try {
      await setDone.mutateAsync({ taskId: task.id, done: true });
    } catch (error) {
      toast.error(error.message);
    }
  };
  const due = formatTaskDue(task.dueDate);
  const cancelled = task.status === TASK_STATUS.Cancelled;
  const handedOver = Boolean(task.handedOver);
  // A handed-over rejection is history; only a live one needs attention.
  const rejected = task.status === TASK_STATUS.Rejected && !handedOver;
  const finished = cancelled || handedOver || task.status === TASK_STATUS.Done;
  const canEditThis = canEdit && !cancelled && !handedOver;
  const canRemove = task.canRemove && !handedOver;
  const actions =
    !handedOver && (task.canComplete || task.canReject || task.canCancel);
  const outcome = taskOutcomeText(task);

  return (
    <li
      data-testid={`task-${task.id}`}
      data-status={task.status}
      data-handed-over={handedOver ? "true" : undefined}
      data-overdue={task.isOverdue ? "true" : undefined}
      className="py-3"
    >
      <div className="flex items-start gap-2">
        <div
          className={`min-w-0 flex-1 ${rejected ? "border-l-4 border-brand-orange pl-2" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusChip status={task.status} handedOver={handedOver} />
            <p
              data-testid="task-title"
              title={task.isDone ? doneText(task) || undefined : undefined}
              className={`min-w-0 text-sm break-words ${finished ? "text-muted line-through" : "text-ink"}`}
            >
              {task.title}
            </p>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
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
          {outcome && (
            <p
              data-testid="task-outcome"
              className={`mt-1 text-xs break-words whitespace-pre-line ${rejected ? "font-semibold text-brand-orange-ink" : "text-muted"}`}
            >
              {outcome}
            </p>
          )}
        </div>
        {(canEditThis || canRemove) && (
          <span className="flex shrink-0">
            {canEditThis && (
              <button
                type="button"
                aria-label={`Edit task: ${task.title}`}
                title={rejected ? "Give it to someone else" : undefined}
                onClick={() => setEditing(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-page hover:text-ink"
              >
                <Pencil aria-hidden="true" size={16} />
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                aria-label={`Remove task: ${task.title}`}
                title="Remove a task added by mistake"
                onClick={() => onRemove(task)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-light hover:text-danger"
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            )}
          </span>
        )}
      </div>
      {actions && (
        <div className="mt-2 flex flex-wrap gap-2">
          {task.canComplete && (
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              busy={setDone.isPending}
              onClick={complete}
              aria-label={`Done: ${task.title}`}
            >
              Done
            </Button>
          )}
          {task.canReject && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 sm:min-h-8"
              onClick={() => setReasonFor("reject")}
              aria-label={`Reject: ${task.title}`}
            >
              Reject
            </Button>
          )}
          {task.canCancel && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 sm:min-h-8"
              onClick={() => setReasonFor("cancel")}
              aria-label={`Cancel task: ${task.title}`}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {reasonFor && (
        <TaskReasonDialog
          ticketId={ticketId}
          task={task}
          kind={reasonFor}
          onClose={() => setReasonFor(null)}
        />
      )}
    </li>
  );
}

/**
 * The ticket's checklist: for its staff, and for a person given a task on it (who sees only their
 * own and cannot add, edit or remove: canEdit false). Never render it for a requester who is not
 * staff (they would get 404). "2 open, 1 rejected, 3 done" (in the warning colour while a task is
 * rejected: it still blocks resolving) with a bar, the tasks in the order added, and "Add a task".
 * Once the ticket is Resolved, Closed or Cancelled everything is read only, with the reason.
 */
export default function TasksPanel({ ticket }) {
  const toast = useToast();
  const tasks = useTicketTasks(ticket.id);
  const remove = useRemoveTask(ticket.id);
  const [removing, setRemoving] = useState(null);
  const data = tasks.data;
  // Cancelled tasks are not work to do: the bar counts the rest.
  const total = data ? data.open + data.rejected + data.done : 0;
  const summary = tasksSummary(data);
  const staff = Boolean(ticket.isStaffView);

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
        {summary && (
          <span
            data-testid="tasks-progress"
            className={`text-sm ${data.rejected > 0 ? "font-semibold text-brand-orange-ink" : "text-body"}`}
          >
            {summary}
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
          {!data.canEdit && staff && (
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
            <p className="mt-3 text-sm text-muted">
              {staff ? "No tasks yet." : "No tasks for you on this ticket."}
            </p>
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
