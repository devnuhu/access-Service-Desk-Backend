import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { Button, Dialog, useToast } from "@/shared/ui";
import { useMergeTicket } from "../hooks/useLinks.js";
import { personName } from "../ticketText.js";

const REASON_MIN = 3;
const REASON_MAX = 500;

/**
 * Merge `ticket` (the duplicate) into the ticket to keep. The duplicate closes for good; nothing is
 * deleted. copyRequester is sent true only when ticked. On success: the server's message, every
 * ticket and dashboard query refreshes, and the kept ticket opens. `defaultTarget` pre-fills the
 * reference (bulk Merge in the Work queue).
 */
export default function MergeDialog({ ticket, defaultTarget = "", onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const merge = useMergeTicket(ticket.id);
  const [target, setTarget] = useState(defaultTarget);
  const [reason, setReason] = useState("");
  const [copyRequester, setCopyRequester] = useState(false);
  const [errors, setErrors] = useState({});
  const targetRef = useRef(null);
  const requester = ticket.requester
    ? personName(ticket.requester)
    : "the requester";

  const submit = async (event) => {
    event.preventDefault();
    const reference = target.trim().toUpperCase();
    const why = reason.trim();
    const found = {};
    if (!reference)
      found.targetReference = "Enter the reference of the ticket to keep.";
    else if (reference === ticket.reference.toUpperCase())
      found.targetReference =
        "Choose another ticket: this is the one being merged.";
    if (why.length < REASON_MIN || why.length > REASON_MAX)
      found.reason = `Say why they are merged (${REASON_MIN} to ${REASON_MAX} characters).`;
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const result = await merge.mutateAsync({
        targetReference: reference,
        reason: why,
        copyRequester,
      });
      toast.success(result.message);
      onClose();
      navigate(`/tickets/${reference}`);
    } catch (error) {
      const server = {
        targetReference: fieldError(error, "targetReference"),
        reason: fieldError(error, "reason"),
      };
      // A 404 (no such ticket I work on) or 409 is about the reference.
      if (
        !server.targetReference &&
        !server.reason &&
        [404, 409].includes(error.status)
      )
        server.targetReference = error.message;
      setErrors({
        ...server,
        form:
          server.targetReference || server.reason ? undefined : error.message,
      });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Merge ${ticket.reference} into another ticket`}
      initialFocusRef={targetRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="merge-form"
            variant="danger"
            busy={merge.isPending}
          >
            Merge
          </Button>
        </>
      }
    >
      <form id="merge-form" onSubmit={submit} noValidate className="space-y-4">
        {errors.form && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {errors.form}
          </p>
        )}
        <div>
          <label
            htmlFor="merge-target"
            className="block text-sm font-semibold text-ink"
          >
            Reference of the ticket to keep
          </label>
          <input
            ref={targetRef}
            id="merge-target"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setErrors((e) => ({
                ...e,
                targetReference: undefined,
                form: undefined,
              }));
            }}
            placeholder="CP-2026-000123"
            autoComplete="off"
            aria-invalid={errors.targetReference ? "true" : undefined}
            aria-describedby={
              errors.targetReference ? "merge-target-error" : undefined
            }
            className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${errors.targetReference ? "border-danger" : "border-line"}`}
          />
          {errors.targetReference && (
            <p
              id="merge-target-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.targetReference}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="merge-reason"
            className="block text-sm font-semibold text-ink"
          >
            Why are they merged?
          </label>
          <textarea
            id="merge-reason"
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setErrors((e) => ({ ...e, reason: undefined, form: undefined }));
            }}
            aria-invalid={errors.reason ? "true" : undefined}
            aria-describedby={errors.reason ? "merge-reason-error" : undefined}
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-ink ${errors.reason ? "border-danger" : "border-line"}`}
          />
          {errors.reason && (
            <p
              id="merge-reason-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.reason}
            </p>
          )}
        </div>
        <div className="flex gap-2.5">
          <input
            id="merge-copy"
            type="checkbox"
            checked={copyRequester}
            onChange={(event) => setCopyRequester(event.target.checked)}
            aria-describedby="merge-copy-help"
            className="mt-0.5 h-4 w-4 accent-brand-navy"
          />
          <div>
            <label
              htmlFor="merge-copy"
              className="text-sm font-semibold text-ink"
            >
              Also copy {requester} on that ticket
            </label>
            <p id="merge-copy-help" className="text-xs text-muted">
              Only needed when the two requests came from different people. They
              will then see the other ticket&apos;s public comments.
            </p>
          </div>
        </div>
        <p
          role="note"
          className="flex gap-2 rounded-lg border border-brand-orange bg-brand-orange-light px-3 py-2 text-sm text-brand-orange-ink"
        >
          <TriangleAlert
            aria-hidden="true"
            size={16}
            className="mt-0.5 shrink-0"
          />
          {ticket.reference} will be closed and cannot be reopened. Nothing is
          deleted.
        </p>
      </form>
    </Dialog>
  );
}
