import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { Button, Chip, Dialog, useToast } from "@/shared/ui";
import { refreshTickets, useReassign } from "../hooks/useTickets.js";
import {
  personName,
  REASON_MAX,
  REASON_MIN,
  TICKET_CONFLICT,
} from "../ticketText.js";

/**
 * Choose who should handle the ticket, and why. Candidates come from reassign-options (grouped by
 * unit when there are several); the current assignee is shown but cannot be chosen. Choosing
 * someone in another unit warns that the ticket moves there.
 */
export default function ReassignDialog({ ticket, candidates, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reassign = useReassign(ticket.id);
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);

  const units = [];
  for (const candidate of candidates) {
    let unit = units.find((u) => u.unitId === candidate.unitId);
    if (!unit) {
      unit = {
        unitId: candidate.unitId,
        unitName: candidate.unitName,
        people: [],
      };
      units.push(unit);
    }
    unit.people.push(candidate);
  }
  const chosen = candidates.find((c) => c.userId === toUserId);
  const moves = chosen && chosen.unitId !== ticket.unitId;
  const length = reason.trim().length;

  const save = async (event) => {
    event.preventDefault();
    setFailure(null);
    const found = {};
    if (!toUserId) found.toUserId = "Choose who should handle it.";
    if (length < REASON_MIN || length > REASON_MAX)
      found.reason = `Give a reason (${REASON_MIN} to ${REASON_MAX} characters).`;
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const result = await reassign.mutateAsync({
        toUserId,
        reason: reason.trim(),
      });
      toast.success(result.message);
      await refreshTickets(queryClient);
      onClose();
    } catch (error) {
      if (error.status === 409) {
        toast.warning(TICKET_CONFLICT);
        await refreshTickets(queryClient);
        onClose();
        return;
      }
      const server = {
        toUserId: fieldError(error, "toUserId"),
        reason: fieldError(error, "reason"),
      };
      setErrors(server);
      if (!server.toUserId && !server.reason) setFailure(error.message);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reassign ${ticket.reference}`}
      description={`${ticket.categoryName} · ${ticket.unitName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reassign-form" busy={reassign.isPending}>
            Reassign
          </Button>
        </>
      }
    >
      <form id="reassign-form" onSubmit={save} noValidate className="space-y-4">
        {failure && (
          <p
            role="alert"
            className="rounded-[6px] border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {failure}
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Pass it to</legend>
          {candidates.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No one else is available to take it right now.
            </p>
          ) : (
            units.map((unit) => (
              <div key={unit.unitId} className="mt-2">
                {units.length > 1 && (
                  <p className="mb-1 text-xs font-semibold text-muted uppercase">
                    {unit.unitName}
                  </p>
                )}
                <ul className="divide-y divide-line rounded-[6px] border border-line">
                  {unit.people.map((person) => {
                    const id = `reassign-${person.userId}`;
                    return (
                      <li
                        key={person.userId}
                        data-testid={`candidate-${person.userName}`}
                        className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${person.isCurrentAssignee ? "bg-page" : ""}`}
                      >
                        <input
                          id={id}
                          type="radio"
                          name="toUserId"
                          value={person.userId}
                          checked={toUserId === person.userId}
                          disabled={person.isCurrentAssignee}
                          onChange={() => {
                            setToUserId(person.userId);
                            setErrors((e) => ({ ...e, toUserId: undefined }));
                          }}
                          className="h-4 w-4"
                        />
                        <label
                          htmlFor={id}
                          className={`min-w-0 flex-1 ${person.isCurrentAssignee ? "text-muted" : "cursor-pointer text-ink"}`}
                        >
                          <span className="font-semibold">
                            {personName(person)}
                          </span>
                          <span className="ml-1 text-xs text-muted">
                            {person.userName}
                          </span>
                        </label>
                        <Chip tone="navy">Workload {person.workload}</Chip>
                        {person.handlesCategory ? (
                          <Chip tone="green">Handles this category</Chip>
                        ) : (
                          <Chip tone="orange">Not mapped</Chip>
                        )}
                        {person.isCurrentAssignee && (
                          <Chip tone="grey">Current</Chip>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          {errors.toUserId && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.toUserId}
            </p>
          )}
        </fieldset>

        {moves && (
          <p
            role="status"
            className="flex gap-2 rounded-[6px] border border-brand-orange bg-brand-orange-light px-3 py-2 text-sm text-brand-orange-ink"
          >
            <TriangleAlert
              aria-hidden="true"
              size={16}
              className="mt-0.5 shrink-0"
            />
            This moves the ticket to {chosen.unitName}.
          </p>
        )}

        <div>
          <label
            htmlFor="reassign-reason"
            className="block text-sm font-semibold text-ink"
          >
            Reason
          </label>
          <textarea
            id="reassign-reason"
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (errors.reason)
                setErrors((e) => ({ ...e, reason: undefined }));
            }}
            maxLength={REASON_MAX + 50}
            aria-invalid={errors.reason ? "true" : undefined}
            aria-describedby={`reassign-reason-count${errors.reason ? " reassign-reason-error" : ""}`}
            className={`mt-1 w-full rounded-[6px] border px-3 py-2 text-sm text-ink ${errors.reason ? "border-danger" : "border-line"}`}
          />
          <p
            id="reassign-reason-count"
            className={`text-right text-xs ${length > REASON_MAX ? "font-medium text-danger" : "text-muted"}`}
          >
            {length} of {REASON_MAX} characters
          </p>
          {errors.reason && (
            <p
              id="reassign-reason-error"
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
