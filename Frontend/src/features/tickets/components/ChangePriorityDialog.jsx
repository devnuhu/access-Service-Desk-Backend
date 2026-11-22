import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PRIORITY, PRIORITY_LABELS } from "@/features/catalogue";
import { fieldError } from "@/shared/lib/http";
import { Button, Dialog, useToast } from "@/shared/ui";
import { refreshTickets, useChangePriority } from "../hooks/useTickets.js";
import { REASON_MAX, REASON_MIN } from "../ticketText.js";

const CONFLICT = "The ticket changed at the same moment. Reload and try again.";

/**
 * Change an open ticket's priority, with a reason (5 to 500 characters, kept as an internal note).
 * The current priority is shown but cannot be chosen. After saving, every ticket query refreshes,
 * so the chip, the timeline note and the service-level clock follow.
 */
export default function ChangePriorityDialog({ ticket, current, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const change = useChangePriority(ticket.id);
  const [priority, setPriority] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [conflict, setConflict] = useState(false);
  const length = reason.trim().length;

  const save = async (event) => {
    event.preventDefault();
    setFailure(null);
    setConflict(false);
    const found = {};
    if (!priority) found.priority = "Choose the new priority.";
    if (length < REASON_MIN || length > REASON_MAX)
      found.reason = `Say why the priority changes (${REASON_MIN} to ${REASON_MAX} characters).`;
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const result = await change.mutateAsync({
        priority: Number(priority),
        reason: reason.trim(),
      });
      toast.success(result.message);
      await refreshTickets(queryClient);
      onClose();
    } catch (error) {
      if (error.status === 409) {
        setConflict(true);
        return;
      }
      const server = {
        priority: fieldError(error, "priority"),
        reason: fieldError(error, "reason"),
      };
      setErrors(server);
      if (!server.priority && !server.reason) setFailure(error.message);
    }
  };

  const reload = async () => {
    await refreshTickets(queryClient);
    onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={`Change the priority of ${ticket.reference}`}
      description="The response and resolution times follow the new priority. The reason is kept as an internal note."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="priority-form"
            busy={change.isPending}
            busyText="Saving…"
          >
            Change priority
          </Button>
        </>
      }
    >
      <form id="priority-form" onSubmit={save} noValidate className="space-y-4">
        {conflict && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-orange bg-brand-orange-light px-3 py-2 text-sm text-brand-orange-ink"
          >
            {CONFLICT}
            <Button size="sm" variant="secondary" onClick={reload}>
              Reload
            </Button>
          </div>
        )}
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
            htmlFor="priority-new"
            className="block text-sm font-semibold text-ink"
          >
            New priority
          </label>
          <select
            id="priority-new"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              if (errors.priority)
                setErrors((e) => ({ ...e, priority: undefined }));
            }}
            aria-invalid={errors.priority ? "true" : undefined}
            aria-describedby={
              errors.priority ? "priority-new-error" : undefined
            }
            className={`mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm text-ink ${errors.priority ? "border-danger" : "border-line"}`}
          >
            <option value="">Choose a priority</option>
            {Object.values(PRIORITY).map((value) => (
              <option key={value} value={value} disabled={value === current}>
                {PRIORITY_LABELS[value]}
                {value === current ? " (current)" : ""}
              </option>
            ))}
          </select>
          {errors.priority && (
            <p
              id="priority-new-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.priority}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="priority-reason"
            className="block text-sm font-semibold text-ink"
          >
            Reason
          </label>
          <textarea
            id="priority-reason"
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (errors.reason)
                setErrors((e) => ({ ...e, reason: undefined }));
            }}
            maxLength={REASON_MAX + 50}
            aria-invalid={errors.reason ? "true" : undefined}
            aria-describedby={`priority-reason-count${errors.reason ? " priority-reason-error" : ""}`}
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink ${errors.reason ? "border-danger" : "border-line"}`}
          />
          <p
            id="priority-reason-count"
            className={`text-right text-xs ${length > REASON_MAX ? "font-medium text-danger" : "text-muted"}`}
          >
            {length} of {REASON_MAX} characters
          </p>
          {errors.reason && (
            <p
              id="priority-reason-error"
              className="text-xs font-medium text-danger"
            >
              {errors.reason}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
