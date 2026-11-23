import { useState } from "react";
import { Button, Card, useToast } from "@/shared/ui";
import useRunAction from "../hooks/useRunAction.js";
import {
  CancelDialog,
  ConfirmDialog,
  EscalateDialog,
  PendingDialog,
  ReopenDialog,
  ResolveDialog,
} from "./WorkflowDialogs.jsx";

/**
 * The side panel's Actions card: the assignee's buttons, and a Super Admin's Cancel on someone
 * else's ticket. Only the flags the API sets show a button; with none there is no card.
 */
export function ActionsCard({ ticket, actions, isRequester }) {
  const toast = useToast();
  const { run, busy } = useRunAction(ticket.id);
  const [dialog, setDialog] = useState(null);
  const close = () => setDialog(null);
  const canCancel = actions.canCancel && !isRequester;
  const any =
    actions.canAcknowledge ||
    actions.canResume ||
    actions.canSetPending ||
    actions.canResolve ||
    actions.canEscalate ||
    canCancel;
  if (!any) return null;

  const direct = async (action) => {
    const error = await run(action);
    if (error) toast.error(error.message);
  };

  return (
    <Card className="p-5" aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="text-base font-semibold">
        Actions
      </h2>
      <div className="mt-3 space-y-2">
        {actions.canAcknowledge && (
          <Button
            className="w-full"
            busy={busy}
            onClick={() => direct("acknowledge")}
          >
            Start work
          </Button>
        )}
        {actions.canResume && (
          <Button
            variant="secondary"
            className="w-full"
            busy={busy}
            onClick={() => direct("resume")}
          >
            Resume work
          </Button>
        )}
        {actions.canResolve && (
          <Button className="w-full" onClick={() => setDialog("resolve")}>
            Resolve
          </Button>
        )}
        {actions.canSetPending && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setDialog("pending")}
          >
            Set pending
          </Button>
        )}
        {actions.canEscalate && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setDialog("escalate")}
          >
            Escalate to unit head
          </Button>
        )}
        {canCancel && (
          <Button
            variant="danger"
            className="w-full"
            onClick={() => setDialog("cancel")}
          >
            Cancel ticket
          </Button>
        )}
      </div>
      {dialog === "pending" && (
        <PendingDialog ticketId={ticket.id} onClose={close} />
      )}
      {dialog === "resolve" && (
        <ResolveDialog
          ticketId={ticket.id}
          codes={actions.resolutionCodes}
          checkTasks={ticket.isStaffView}
          onClose={close}
        />
      )}
      {dialog === "cancel" && (
        <CancelDialog ticketId={ticket.id} forEveryone onClose={close} />
      )}
      {dialog === "escalate" && (
        <EscalateDialog ticketId={ticket.id} onClose={close} />
      )}
    </Card>
  );
}

/** The requester's buttons, in the status callout at the top of the page. */
export function RequesterActions({ ticket, actions, isRequester }) {
  const [dialog, setDialog] = useState(null);
  const close = () => setDialog(null);
  const canCancel = actions.canCancel && isRequester;
  if (!actions.canConfirm && !actions.canReopen && !canCancel) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.canConfirm && (
        <Button onClick={() => setDialog("confirm")}>
          Confirm it&apos;s resolved
        </Button>
      )}
      {actions.canReopen && (
        <Button variant="secondary" onClick={() => setDialog("reopen")}>
          It&apos;s not resolved
        </Button>
      )}
      {canCancel && (
        <Button variant="danger" onClick={() => setDialog("cancel")}>
          Cancel ticket
        </Button>
      )}
      {dialog === "confirm" && (
        <ConfirmDialog ticketId={ticket.id} onClose={close} />
      )}
      {dialog === "reopen" && (
        <ReopenDialog ticketId={ticket.id} onClose={close} />
      )}
      {dialog === "cancel" && (
        <CancelDialog ticketId={ticket.id} onClose={close} />
      )}
    </div>
  );
}
