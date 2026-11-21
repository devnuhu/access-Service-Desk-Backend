import { useState } from "react";
import { UserRoundCog } from "lucide-react";
import { Button, Card } from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import { useReassignOptions } from "../hooks/useTickets.js";
import { personName } from "../ticketText.js";
import Ago from "./Ago.jsx";
import AssignmentHistory from "./AssignmentHistory.jsx";
import ReassignDialog from "./ReassignDialog.jsx";
import SlaHistory from "./SlaHistory.jsx";

/**
 * Staff only (the ticket page shows it when isStaffView): who has the ticket and since when,
 * Reassign (or why not), and the assignment history. Requesters and copied colleagues never
 * mount it, so they never call these endpoints.
 */
export default function AssignmentPanel({ ticket }) {
  const [reassigning, setReassigning] = useState(false);
  const options = useReassignOptions(ticket.id);
  const waiting = ticket.status === STATUS.New;

  return (
    <Card className="p-5" aria-labelledby="assignment-heading">
      <h2 id="assignment-heading" className="text-base font-semibold">
        Assignment
      </h2>

      <div className="mt-3 flex gap-3" data-testid="assignee-block">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy-light text-brand-navy">
          <UserRoundCog aria-hidden="true" size={17} />
        </span>
        <div className="min-w-0 text-sm">
          {waiting || !ticket.assignee ? (
            <p className="font-semibold text-brand-orange-ink">
              Waiting for an available case worker
            </p>
          ) : (
            <>
              <p className="font-semibold text-ink">
                {personName(ticket.assignee)}
              </p>
              <p className="text-xs text-muted">{ticket.unitName}</p>
              {ticket.assignedAt && (
                <p className="text-xs text-muted">
                  Assigned <Ago at={ticket.assignedAt} />
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        {options.isLoading ? null : options.isError ? (
          <p role="alert" className="text-sm text-danger">
            {options.error.message}
          </p>
        ) : options.data.canReassign ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setReassigning(true)}
          >
            Reassign
          </Button>
        ) : (
          <p className="text-sm text-muted" data-testid="reassign-reason">
            {options.data.reason}
          </p>
        )}
      </div>

      <div className="mt-4">
        <AssignmentHistory ticketId={ticket.id} />
      </div>

      <div className="mt-4 empty:hidden">
        <SlaHistory ticket={ticket} />
      </div>

      {reassigning && (
        <ReassignDialog
          ticket={ticket}
          candidates={options.data?.candidates ?? []}
          onClose={() => setReassigning(false)}
        />
      )}
    </Card>
  );
}
