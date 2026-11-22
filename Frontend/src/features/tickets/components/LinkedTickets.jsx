import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, MoreHorizontal, X } from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Spinner,
  useToast,
} from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import {
  useAddLink,
  useRemoveLink,
  useTicketLinks,
} from "../hooks/useLinks.js";
import MergeDialog from "./MergeDialog.jsx";
import StatusChip from "./StatusChip.jsx";

/** How a link reads from the ticket on screen. */
const RELATION_LABELS = {
  related: "Related to",
  duplicateOf: "Duplicate of",
  hasDuplicate: "Has duplicate",
  mergedInto: "Merged into",
  hasMerged: "Merged here",
};

const OPEN = [
  STATUS.New,
  STATUS.Assigned,
  STATUS.InProgress,
  STATUS.Pending,
  STATUS.Reopened,
];

/** Link another ticket by reference. 400/404/409 messages show under the reference. */
function LinkDialog({ ticket, onClose }) {
  const toast = useToast();
  const add = useAddLink(ticket.id);
  const [reference, setReference] = useState("");
  const [relation, setRelation] = useState("related");
  const [errors, setErrors] = useState({});
  const inputRef = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const value = reference.trim().toUpperCase();
    if (!value) {
      setErrors({ reference: "Enter a ticket reference." });
      return;
    }
    try {
      const link = await add.mutateAsync({ reference: value, relation });
      toast.success(
        `${RELATION_LABELS[link.relation] ?? "Linked to"} ${link.ticket.reference}.`,
        {
          title: "Ticket linked",
        },
      );
      onClose();
    } catch (error) {
      const relationError = fieldError(error, "relation");
      setErrors({
        reference: relationError
          ? undefined
          : (fieldError(error, "reference") ?? error.message),
        relation: relationError,
      });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Link ${ticket.reference} to another ticket`}
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="link-form" busy={add.isPending}>
            Link
          </Button>
        </>
      }
    >
      <form id="link-form" onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="link-reference"
            className="block text-sm font-semibold text-ink"
          >
            Ticket reference
          </label>
          <input
            ref={inputRef}
            id="link-reference"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              setErrors({});
            }}
            placeholder="CP-2026-000123"
            autoComplete="off"
            aria-invalid={errors.reference ? "true" : undefined}
            aria-describedby={
              errors.reference ? "link-reference-error" : undefined
            }
            className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${errors.reference ? "border-danger" : "border-line"}`}
          />
          {errors.reference && (
            <p
              id="link-reference-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.reference}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="link-relation"
            className="block text-sm font-semibold text-ink"
          >
            {ticket.reference} is
          </label>
          <select
            id="link-relation"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            aria-invalid={errors.relation ? "true" : undefined}
            className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="related">Related to it</option>
            <option value="duplicateOf">A duplicate of it</option>
          </select>
          {errors.relation && (
            <p className="mt-1 text-xs font-medium text-danger">
              {errors.relation}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A closed ticket merged into another: "This ticket was merged into <reference>." (staff view; the
 * thread has the same text for everyone).
 */
export function MergedBanner({ ticket }) {
  const links = useTicketLinks(ticket.id, {
    enabled: ticket.status === STATUS.Closed,
  });
  const merged = links.data?.find((link) => link.relation === "mergedInto");
  if (!merged) return null;
  return (
    <p
      data-testid="merged-banner"
      className="rounded-card border border-brand-navy/20 bg-brand-navy-light px-4 py-3 text-sm text-ink"
    >
      This ticket was merged into{" "}
      <Link
        to={`/tickets/${merged.ticket.reference}`}
        className="font-semibold text-brand-navy hover:underline"
      >
        {merged.ticket.reference}
      </Link>
      .
    </p>
  );
}

/** "⋯": the rarer actions. Merge only while the ticket is open. */
function MoreMenu({ canMerge, onMerge }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!canMerge) return null;
  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="More ticket actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-9 right-0 z-30 w-60 rounded-lg border border-line bg-white p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onMerge();
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-page"
          >
            Merge into another ticket
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Linked tickets (staff view only): each link with how it relates, the other ticket's reference
 * (a link), subject (null when I am not staff for it) and status, and a remove button unless it is
 * a merge. "Link ticket" adds one; "⋯" holds Merge into another ticket while this one is open.
 */
export default function LinkedTickets({ ticket }) {
  const toast = useToast();
  const links = useTicketLinks(ticket.id);
  const remove = useRemoveLink(ticket.id);
  const [dialog, setDialog] = useState(null);
  const [removing, setRemoving] = useState(null);
  const list = links.data ?? [];

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
      className="p-5"
      aria-labelledby="links-heading"
      data-testid="linked-tickets"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="links-heading"
          className="min-w-0 truncate text-base font-semibold whitespace-nowrap"
        >
          Linked tickets
        </h2>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("link")}
            aria-label="Link ticket"
            className="whitespace-nowrap"
          >
            <Link2 aria-hidden="true" size={14} />
            Link
          </Button>
          <MoreMenu
            canMerge={OPEN.includes(ticket.status)}
            onMerge={() => setDialog("merge")}
          />
        </span>
      </div>
      {links.isLoading ? (
        <Spinner label="Loading links…" />
      ) : links.isError ? (
        <p role="alert" className="text-sm text-danger">
          {links.error.message}
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">No linked tickets.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((link) => (
            <li
              key={link.id}
              data-testid={`link-${link.ticket.reference}`}
              className="flex items-start gap-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  {RELATION_LABELS[link.relation] ?? link.relation}
                </p>
                <Link
                  to={`/tickets/${link.ticket.reference}`}
                  className="font-semibold text-brand-navy hover:underline"
                >
                  {link.ticket.reference}
                </Link>
                {link.ticket.subject && (
                  <p className="line-clamp-2 text-body">
                    {link.ticket.subject}
                  </p>
                )}
                <div className="mt-1">
                  <StatusChip status={link.ticket.status} />
                </div>
              </div>
              {link.canRemove && (
                <button
                  type="button"
                  aria-label={`Remove the link to ${link.ticket.reference}`}
                  onClick={() => setRemoving(link)}
                  className="rounded-md p-1 text-muted hover:bg-danger-light hover:text-danger"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog === "link" && (
        <LinkDialog ticket={ticket} onClose={() => setDialog(null)} />
      )}
      {dialog === "merge" && (
        <MergeDialog ticket={ticket} onClose={() => setDialog(null)} />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove the link to ${removing?.ticket.reference ?? ""}?`}
        message="Both tickets stay as they are; only the link goes."
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
