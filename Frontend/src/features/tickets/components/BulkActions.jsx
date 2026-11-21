import { useState } from "react";
import { CheckCircle2, CircleX, Hand, Play, Repeat, X } from "lucide-react";
import { Button, Dialog, Spinner, useToast } from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import { useReassignOptions, useTicketActions } from "../hooks/useTickets.js";
import { useBulkAction } from "../hooks/useQueueTools.js";
import { personName, REASON_MAX, REASON_MIN } from "../ticketText.js";

export const BULK_MAX = 50;
const NOTE_MIN = 10;
const NOTE_MAX = 4000;

const field = "mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink";

/**
 * Pass the selected tickets to one person. The people offered are those who may take the first
 * selected ticket (its reassign options); each ticket still follows its own rules on the server.
 */
function BulkReassignDialog({ tickets, busy, onRun, onClose }) {
  const options = useReassignOptions(tickets[0].id);
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const people = (options.data?.candidates ?? []).filter(
    (c) => !c.isCurrentAssignee,
  );

  const submit = (event) => {
    event.preventDefault();
    const found = {};
    const length = reason.trim().length;
    if (!toUserId) found.toUserId = "Choose who should handle them.";
    if (length < REASON_MIN || length > REASON_MAX)
      found.reason = `Give a reason (${REASON_MIN} to ${REASON_MAX} characters).`;
    setErrors(found);
    if (!Object.keys(found).length) onRun({ toUserId, reason: reason.trim() });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reassign ${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}
      description="Each ticket is checked on its own; any that cannot move are listed afterwards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-reassign-form" busy={busy}>
            Reassign
          </Button>
        </>
      }
    >
      <form
        id="bulk-reassign-form"
        onSubmit={submit}
        noValidate
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="bulk-reassign-to"
            className="block text-sm font-semibold text-ink"
          >
            Pass them to
          </label>
          {options.isLoading ? (
            <Spinner label="Loading people…" />
          ) : (
            <select
              id="bulk-reassign-to"
              value={toUserId}
              onChange={(event) => {
                setToUserId(event.target.value);
                setErrors((e) => ({ ...e, toUserId: undefined }));
              }}
              aria-invalid={errors.toUserId ? "true" : undefined}
              className={`${field} h-10 bg-white ${errors.toUserId ? "border-danger" : "border-line"}`}
            >
              <option value="">Choose a person</option>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {personName(person)} · {person.unitName} · workload{" "}
                  {person.workload}
                </option>
              ))}
            </select>
          )}
          {errors.toUserId && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.toUserId}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="bulk-reassign-reason"
            className="block text-sm font-semibold text-ink"
          >
            Reason
          </label>
          <textarea
            id="bulk-reassign-reason"
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setErrors((e) => ({ ...e, reason: undefined }));
            }}
            aria-invalid={errors.reason ? "true" : undefined}
            className={`${field} ${errors.reason ? "border-danger" : "border-line"}`}
          />
          {errors.reason && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.reason}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Resolve the selected tickets with one resolution code and one note (posted on each). The codes
 * come from the first selected ticket's actions.
 */
function BulkResolveDialog({ tickets, busy, onRun, onClose }) {
  const actions = useTicketActions(tickets[0].id);
  const codes = actions.data?.resolutionCodes ?? [];
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});

  const submit = (event) => {
    event.preventDefault();
    const found = {};
    const length = note.trim().length;
    if (!code) found.code = "Choose how it was resolved.";
    if (length < NOTE_MIN || length > NOTE_MAX)
      found.note = `Write a note (${NOTE_MIN} to ${NOTE_MAX} characters).`;
    setErrors(found);
    if (!Object.keys(found).length)
      onRun({ code: Number(code), note: note.trim() });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Resolve ${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}
      description="The note is posted on each ticket for its requester to read."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-resolve-form" busy={busy}>
            Resolve
          </Button>
        </>
      }
    >
      <form
        id="bulk-resolve-form"
        onSubmit={submit}
        noValidate
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="bulk-resolve-code"
            className="block text-sm font-semibold text-ink"
          >
            Resolution
          </label>
          {actions.isLoading ? (
            <Spinner label="Loading…" />
          ) : (
            <select
              id="bulk-resolve-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setErrors((e) => ({ ...e, code: undefined }));
              }}
              aria-invalid={errors.code ? "true" : undefined}
              className={`${field} h-10 bg-white ${errors.code ? "border-danger" : "border-line"}`}
            >
              <option value="">Choose one</option>
              {codes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          {errors.code && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.code}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="bulk-resolve-note"
            className="block text-sm font-semibold text-ink"
          >
            Note to the requester
          </label>
          <textarea
            id="bulk-resolve-note"
            rows={4}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setErrors((e) => ({ ...e, note: undefined }));
            }}
            aria-invalid={errors.note ? "true" : undefined}
            className={`${field} ${errors.note ? "border-danger" : "border-line"}`}
          />
          {errors.note && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.note}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/** "12 done, 3 not done", with each ticket that was not done and why. */
function BulkSummaryDialog({ result, onClose }) {
  const failed = result.items.filter((item) => !item.ok);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${result.succeeded} done, ${result.failed} not done`}
      description={
        result.failed
          ? "The tickets below were left as they were."
          : "Every selected ticket was done."
      }
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {failed.length > 0 ? (
        <ul
          aria-label="Not done"
          className="divide-y divide-line rounded-lg border border-line"
        >
          {failed.map((item) => (
            <li
              key={item.ticketId}
              data-testid={`bulk-failed-${item.reference ?? item.ticketId}`}
              className="flex gap-2 px-3 py-2 text-sm"
            >
              <CircleX
                aria-hidden="true"
                size={16}
                className="mt-0.5 shrink-0 text-danger"
              />
              <span>
                <span className="font-semibold text-ink">
                  {item.reference ?? "A ticket"}
                </span>{" "}
                <span className="text-body">{item.message}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-brand-green-text">
          <CheckCircle2 aria-hidden="true" size={18} />
          All {result.succeeded} done.
        </p>
      )}
    </Dialog>
  );
}

/**
 * The toolbar for ticked tickets (at most 50 at a time). Shows only the actions that fit the tab
 * and the selected rows: Pick in the pool; Start work and Resolve on Assigned to me; Reassign for
 * those who oversee (`canReassign`). The server still checks each ticket; a ticket it refuses is
 * listed in the summary, never as an error. After a run the selection clears (`onDone`).
 */
export default function BulkActions({
  tickets,
  pool = false,
  mine = false,
  canReassign = false,
  onClear,
  onDone,
}) {
  const toast = useToast();
  const bulk = useBulkAction();
  const [dialog, setDialog] = useState(null);
  const [summary, setSummary] = useState(null);
  const tooMany = tickets.length > BULK_MAX;
  const startable = tickets.filter((t) =>
    [STATUS.Assigned, STATUS.Reopened].includes(t.status),
  );
  const resolvable = tickets.filter((t) => t.status === STATUS.InProgress);

  const run = async (action, chosen, body = {}) => {
    try {
      const result = await bulk.mutateAsync({
        action,
        ticketIds: chosen.map((t) => t.id),
        ...body,
      });
      setDialog(null);
      setSummary(result);
      onDone();
    } catch (error) {
      // Only a wrong list (empty, over 50) or a lost connection gets here.
      toast.error(error.message);
    }
  };

  const busy = bulk.isPending;
  return (
    <>
      {tickets.length > 0 && (
        <div
          role="region"
          aria-label="Selected tickets"
          className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-navy-light/60 px-5 py-2.5"
        >
          <span className="text-sm font-semibold text-ink">
            {tickets.length} selected
          </span>
          {tooMany ? (
            <span role="alert" className="text-sm text-danger">
              Select at most {BULK_MAX} tickets at a time.
            </span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {pool && (
                <Button
                  size="sm"
                  busy={busy}
                  onClick={() => run("pick", tickets)}
                >
                  <Hand aria-hidden="true" size={14} />
                  Pick
                </Button>
              )}
              {mine && startable.length > 0 && (
                <Button
                  size="sm"
                  busy={busy}
                  onClick={() => run("acknowledge", startable)}
                >
                  <Play aria-hidden="true" size={14} />
                  Start work
                  {startable.length < tickets.length &&
                    ` (${startable.length})`}
                </Button>
              )}
              {mine && resolvable.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialog("resolve")}
                >
                  <CheckCircle2 aria-hidden="true" size={14} />
                  Resolve
                  {resolvable.length < tickets.length &&
                    ` (${resolvable.length})`}
                </Button>
              )}
              {canReassign && !pool && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialog("reassign")}
                >
                  <Repeat aria-hidden="true" size={14} />
                  Reassign
                </Button>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
          >
            <X aria-hidden="true" size={14} />
            Clear selection
          </button>
        </div>
      )}

      {dialog === "reassign" && (
        <BulkReassignDialog
          tickets={tickets}
          busy={busy}
          onRun={(body) => run("reassign", tickets, body)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "resolve" && (
        <BulkResolveDialog
          tickets={resolvable}
          busy={busy}
          onRun={(body) => run("resolve", resolvable, body)}
          onClose={() => setDialog(null)}
        />
      )}
      {summary && (
        <BulkSummaryDialog result={summary} onClose={() => setSummary(null)} />
      )}
    </>
  );
}
