import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@/shared/ui";
import { PENDING_REASON } from "../api/endpoints.js";
import useRunAction from "../hooks/useRunAction.js";
import { refreshTasks, useTicketTasks } from "../hooks/useTasks.js";
import { openTasksText, TASKS_PANEL_ID, tasksBlockResolve } from "../tasks.js";

/**
 * The shell of every workflow dialog. The browser checks only that required fields are filled
 * (`validate`); length and status rules are the server's, and its answers show here: errors.<field>
 * under the field (`children` gets them), anything else, 403 included, as a message in the dialog.
 */
function WorkflowDialog({
  ticketId,
  action,
  title,
  submitLabel,
  variant = "primary",
  validate = () => ({}),
  body,
  onClose,
  onFailed,
  submitDisabled = false,
  children,
}) {
  const { run, busy } = useRunAction(ticketId);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const formId = `workflow-${action}`;

  const save = async (event) => {
    event.preventDefault();
    setFailure(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const error = await run(action, body?.());
    if (!error) {
      onClose();
      return;
    }
    onFailed?.(error);
    const server = Object.fromEntries(
      Object.entries(error.fieldErrors ?? {}).map(([field, messages]) => [
        field,
        messages[0],
      ]),
    );
    setErrors(server);
    if (!Object.keys(server).length) setFailure(error.message);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={variant}
            busy={busy}
            disabled={submitDisabled}
          >
            {submitLabel}
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
        {children?.(errors)}
      </form>
    </Dialog>
  );
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/** A required text box with a counter. */
function TextField({ id, label, value, onChange, max, error }) {
  const length = value.trim().length;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
      />
      <p
        id={`${id}-count`}
        className={`text-right text-xs ${length > max ? "font-medium text-danger" : "text-muted"}`}
      >
        {length} of {max} characters
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

const WAITING_ON = [
  [PENDING_REASON.Requester, "The requester", "Their reply resumes it."],
  [
    PENDING_REASON.ThirdParty,
    "A third party",
    "For example an employer or another PFA.",
  ],
];

export function PendingDialog({ ticketId, onClose }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  return (
    <WorkflowDialog
      ticketId={ticketId}
      action="pending"
      title="Set pending"
      submitLabel="Set pending"
      onClose={onClose}
      validate={() => ({
        ...(reason ? {} : { reason: "Choose who it is waiting on." }),
        ...(note.trim() ? {} : { note: "Say what you are waiting for." }),
      })}
      body={() => ({ reason, note: note.trim() })}
    >
      {(errors) => (
        <>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Waiting on
            </legend>
            <div className="mt-1 space-y-1">
              {WAITING_ON.map(([value, label, hint]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 text-sm text-ink"
                >
                  <input
                    type="radio"
                    name="pending-reason"
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    {label}
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <FieldError id="pending-reason-error" message={errors.reason} />
          </fieldset>
          <TextField
            id="pending-note"
            label="What are you waiting for? The requester sees this."
            value={note}
            onChange={setNote}
            max={2000}
            error={errors.note}
          />
        </>
      )}
    </WorkflowDialog>
  );
}

/**
 * Open tasks for the chosen code: a link to the tasks panel (closes the dialog and moves there).
 * The API's own refusal (errors.tasks) shows the same way if it arrives anyway.
 */
function OpenTasksBlock({ message, onClose }) {
  const goToTasks = (event) => {
    event.preventDefault();
    onClose();
    requestAnimationFrame(() => {
      const panel = document.getElementById(TASKS_PANEL_ID);
      panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      panel?.focus?.({ preventScroll: true });
    });
  };
  return (
    <p
      role="alert"
      data-testid="resolve-open-tasks"
      className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
    >
      {message}{" "}
      <a
        href={`#${TASKS_PANEL_ID}`}
        onClick={goToTasks}
        className="font-semibold underline"
      >
        Go to the tasks
      </a>
    </p>
  );
}

/**
 * `checkTasks` (staff view): while tasks are open, Resolve stays disabled unless the code is
 * Duplicate or Raised in error. A refusal from the API refetches the tasks (their open count).
 */
export function ResolveDialog({
  ticketId,
  codes,
  checkTasks = false,
  onClose,
}) {
  const queryClient = useQueryClient();
  const tasks = useTicketTasks(ticketId, { enabled: checkTasks });
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const open = tasks.data?.open ?? 0;
  const blocked = checkTasks && tasksBlockResolve(open, code);
  return (
    <WorkflowDialog
      ticketId={ticketId}
      action="resolve"
      title="Resolve"
      submitLabel="Resolve"
      submitDisabled={blocked}
      onFailed={() => checkTasks && refreshTasks(queryClient, ticketId)}
      onClose={onClose}
      validate={() => ({
        ...(code ? {} : { code: "Choose a resolution code." }),
        ...(note.trim() ? {} : { note: "Tell the requester what was done." }),
      })}
      body={() => ({ code: Number(code), note: note.trim() })}
    >
      {(errors) => (
        <>
          <div>
            <label
              htmlFor="resolve-code"
              className="block text-sm font-semibold text-ink"
            >
              Resolution code
            </label>
            <select
              id="resolve-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={errors.code ? "true" : undefined}
              aria-describedby={errors.code ? "resolve-code-error" : undefined}
              className={`mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink ${errors.code ? "border-danger" : "border-line"}`}
            >
              <option value="">Choose a code</option>
              {codes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <FieldError id="resolve-code-error" message={errors.code} />
          </div>
          {blocked ? (
            <OpenTasksBlock message={openTasksText(open)} onClose={onClose} />
          ) : (
            errors.tasks && (
              <OpenTasksBlock message={errors.tasks} onClose={onClose} />
            )
          )}
          <TextField
            id="resolve-note"
            label="Tell the requester what was done. They see this and confirm it."
            value={note}
            onChange={setNote}
            max={4000}
            error={errors.note}
          />
        </>
      )}
    </WorkflowDialog>
  );
}

export function ConfirmDialog({ ticketId, onClose }) {
  return (
    <WorkflowDialog
      ticketId={ticketId}
      action="confirm"
      title="Close the ticket?"
      submitLabel="Confirm it's resolved"
      onClose={onClose}
    />
  );
}

/** A reason and nothing else: reopen and cancel. */
function ReasonDialog({
  ticketId,
  action,
  title,
  label,
  submitLabel,
  variant,
  required,
  max,
  intro,
  onClose,
}) {
  const [reason, setReason] = useState("");
  return (
    <WorkflowDialog
      ticketId={ticketId}
      action={action}
      title={title}
      submitLabel={submitLabel}
      variant={variant}
      onClose={onClose}
      validate={() => (reason.trim() ? {} : { reason: required })}
      body={() => ({ reason: reason.trim() })}
    >
      {(errors) => (
        <>
          {intro && (
            <p data-testid={`${action}-intro`} className="text-sm text-body">
              {intro}
            </p>
          )}
          <TextField
            id={`${action}-reason`}
            label={label}
            value={reason}
            onChange={setReason}
            max={max}
            error={errors.reason}
          />
        </>
      )}
    </WorkflowDialog>
  );
}

export function ReopenDialog({ ticketId, onClose }) {
  return (
    <ReasonDialog
      ticketId={ticketId}
      action="reopen"
      title="It's not resolved"
      label="Say what is still wrong."
      submitLabel="Reopen the ticket"
      required="Say what is still wrong."
      max={2000}
      onClose={onClose}
    />
  );
}

/** `forEveryone`: a Super Admin cancelling someone else's ticket. */
/**
 * Cancel with a reason. `forEveryone`: someone other than the requester (the case worker, the
 * unit's head, a Super Admin) is cancelling, so the dialog says the requester sees the reason and
 * that it cannot be undone. The API's own refusal (for example a case worker past the deadline)
 * shows as it is given.
 */
export function CancelDialog({ ticketId, forEveryone, onClose }) {
  return (
    <ReasonDialog
      ticketId={ticketId}
      action="cancel"
      title={
        forEveryone ? "Cancel this ticket for everyone?" : "Cancel this ticket?"
      }
      intro={
        forEveryone
          ? "The requester sees this reason on the ticket. Cancelling cannot be undone."
          : undefined
      }
      label="Why is it being cancelled?"
      submitLabel="Cancel ticket"
      variant="danger"
      required="Say why it is being cancelled."
      max={500}
      onClose={onClose}
    />
  );
}

/** The assignee asks the unit's head for help; the reason is kept as an internal note. */
export function EscalateDialog({ ticketId, onClose }) {
  return (
    <ReasonDialog
      ticketId={ticketId}
      action="escalate"
      title="Escalate to unit head"
      label="Why does it need the head of the unit? Staff see this as an internal note."
      submitLabel="Escalate"
      required="Say why it needs the head of the unit."
      max={1000}
      onClose={onClose}
    />
  );
}
