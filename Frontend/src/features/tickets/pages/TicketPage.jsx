import { useState } from "react";
import { useParams } from "react-router-dom";
import { ListChecks, Gauge, SearchX } from "lucide-react";
import { useSession } from "@/features/auth";
import {
  IMPACT_FALLBACK,
  PriorityChip,
  URGENCY_FALLBACK,
  usePriorityMatrix,
} from "@/features/catalogue";
import { formatWat } from "@/shared/lib/time";
import {
  Card,
  Chip,
  MessageCard,
  PageHeader,
  RichTextView,
  Spinner,
} from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import Ago from "../components/Ago.jsx";
import AssignmentPanel from "../components/AssignmentPanel.jsx";
import DueTime from "../components/DueTime.jsx";
import EscalatedBadge from "../components/EscalatedBadge.jsx";
import LinkedTickets, { MergedBanner } from "../components/LinkedTickets.jsx";
import SlaBadge from "../components/SlaBadge.jsx";
import AttachmentList from "../components/AttachmentList.jsx";
import ChangePriorityDialog from "../components/ChangePriorityDialog.jsx";
import PickCard from "../components/PickCard.jsx";
import Conversation from "../components/Conversation.jsx";
import ReplyBox from "../components/ReplyBox.jsx";
import PendingWaitChip from "../components/PendingWaitChip.jsx";
import StatusChip from "../components/StatusChip.jsx";
import StatusCallout from "../components/StatusCallout.jsx";
import TasksPanel from "../components/TasksPanel.jsx";
import { ActionsCard } from "../components/TicketActions.jsx";
import {
  useTicket,
  useTicketActions,
  useTicketPriority,
} from "../hooks/useTickets.js";
import { useMarkRead } from "../hooks/useQueueTools.js";
import { useTicketTasks } from "../hooks/useTasks.js";
import { goToTasksPanel, TASKS_PANEL_ID, tasksMarkerText } from "../tasks.js";
import { personName } from "../ticketText.js";

/**
 * Staff: "Change priority" next to the chip when allowed; when not, the same action disabled with
 * the reason as its tooltip.
 */
function ChangePriorityAction({ ticket, options }) {
  const [open, setOpen] = useState(false);
  if (!options) return null;
  if (!options.canChange) {
    if (!options.reason) return null;
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          title={options.reason}
          aria-describedby="priority-locked"
          className="inline-flex cursor-not-allowed items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted"
        >
          <Gauge aria-hidden="true" size={13} />
          Change priority
        </button>
        <span id="priority-locked" className="sr-only">
          {options.reason}
        </span>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy-light"
      >
        <Gauge aria-hidden="true" size={13} />
        Change priority
      </button>
      {open && (
        <ChangePriorityDialog
          ticket={ticket}
          current={options.priority}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Staff only: what the requester answered on the form ("Requester said: My team, Soon"). */
function RequesterSaid({ options }) {
  const matrix = usePriorityMatrix();
  if (!options?.impact || !options?.urgency) return null;
  const label = (list, fallback, value) =>
    (list?.length ? list : fallback).find((c) => c.value === value)?.label ??
    String(value);
  return (
    <span
      data-testid="requester-said"
      className="mt-1 block text-xs text-muted"
    >
      Requester said:{" "}
      <strong className="font-semibold text-body">
        {label(matrix.data?.impacts, IMPACT_FALLBACK, options.impact)}
      </strong>
      ,{" "}
      <strong className="font-semibold text-body">
        {label(matrix.data?.urgencies, URGENCY_FALLBACK, options.urgency)}
      </strong>
    </span>
  );
}

/**
 * Staff: "2 tasks open, 1 rejected" near the top while tasks stop the ticket being resolved; it
 * moves to the tasks panel. In the warning colour when a task is rejected.
 */
function TasksMarker({ tasks }) {
  const text = tasksMarkerText(tasks);
  if (!text) return null;
  const rejected = tasks.rejected > 0;
  return (
    <a
      href={`#${TASKS_PANEL_ID}`}
      data-testid="tasks-marker"
      onClick={(event) => {
        event.preventDefault();
        goToTasksPanel();
      }}
      className={`inline-flex items-center gap-1.5 rounded-md text-sm font-semibold underline-offset-2 hover:underline ${rejected ? "text-brand-orange-ink" : "text-brand-navy"}`}
    >
      <ListChecks aria-hidden="true" size={16} />
      {text}
    </a>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * One ticket (/tickets/:reference or /tickets/id/:id). A 404 means it does not exist or the person
 * may not see it; the page does not say which. A pushed "Ticket" notification refetches it.
 */
export default function TicketPage() {
  const { reference, id } = useParams();
  const { user } = useSession();
  const query = useTicket({ reference, id });
  // Opening it clears its unread marker (once per ticket opened, not on refetches).
  useMarkRead(query.data?.id);
  const actions = useTicketActions(query.data?.id);
  // Staff only: whether the priority can be changed, and the requester's answers.
  const priorityOptions = useTicketPriority(query.data?.id, {
    enabled: Boolean(query.data?.isStaffView),
  });
  // Tasks: staff see them all; a person given a task here (staff of another unit, say) sees their
  // own, so ask for everyone but a requester who is not staff (they would get 404).
  const loaded = query.data;
  const viewerIsRequester = Boolean(
    loaded &&
    (user.id === loaded.requester.userId || user.id === loaded.raisedBy.userId),
  );
  const tasks = useTicketTasks(loaded?.id, {
    enabled: Boolean(loaded) && (loaded.isStaffView || !viewerIsRequester),
  });

  if (query.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the ticket…" />
      </div>
    );
  }
  if (query.isError) {
    return query.error.status === 404 ? (
      <MessageCard
        icon={SearchX}
        title="Ticket not found"
        linkTo="/tickets"
        linkText="Go to My requests"
      >
        <p>Ticket not found, or you do not have access to it.</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {query.error.message}
      </p>
    );
  }

  const ticket = query.data;
  const raisedForSomeoneElse =
    ticket.raisedBy.userId !== ticket.requester.userId;
  const isRequester = viewerIsRequester;
  // The panel: always for staff (with its loading and error states); for anyone else only once the
  // tasks endpoint has answered 200.
  const showTasks = ticket.isStaffView || tasks.isSuccess;
  const isAssignee = user.id === ticket.assignee?.userId;

  return (
    <div className="space-y-4">
      <PageHeader
        back={
          ticket.isStaffView
            ? `/departments/${ticket.departmentId}/tickets`
            : "/tickets"
        }
        title={<span className="break-words">{ticket.subject}</span>}
        crumb={ticket.reference}
        eyebrow={ticket.reference}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip status={ticket.status} />
          {ticket.isStaffView && <PendingWaitChip ticket={ticket} />}
          <span className="inline-flex items-center gap-1">
            <PriorityChip priority={ticket.priority} />
            {ticket.isStaffView && (
              <ChangePriorityAction
                ticket={ticket}
                options={priorityOptions.data}
              />
            )}
          </span>
          <SlaBadge level={ticket.slaLevel} />
          {ticket.escalatedToHeadAt && (
            <EscalatedBadge at={ticket.escalatedToHeadAt} />
          )}
        </div>
        <p className="mt-3 text-sm text-body">
          {ticket.categoryName} · {ticket.unitName} · {ticket.departmentName}
          <span className="text-muted"> · </span>
          {ticket.locationName}
        </p>
        <p className="mt-1 text-sm text-body">
          Raised {formatWat(ticket.createdAt)} by{" "}
          {raisedForSomeoneElse ? (
            <>
              {personName(ticket.raisedBy)} for{" "}
              <strong className="font-semibold text-ink">
                {personName(ticket.requester)}
              </strong>
            </>
          ) : (
            <strong className="font-semibold text-ink">
              {personName(ticket.requester)}
            </strong>
          )}
          <span className="text-muted"> · </span>
          {ticket.assignee ? (
            <>Assigned to {personName(ticket.assignee)}</>
          ) : (
            <span className="text-muted">Waiting for assignment</span>
          )}
        </p>
      </PageHeader>

      {ticket.isStaffView && <MergedBanner ticket={ticket} />}
      <StatusCallout
        ticket={ticket}
        actions={actions.data}
        isRequester={isRequester}
        isAssignee={isAssignee}
      />
      {ticket.isStaffView && tasks.data && <TasksMarker tasks={tasks.data} />}
      {ticket.isStaffView && ticket.escalatedToHeadReason && (
        <p
          data-testid="escalation-reason"
          className="rounded-card border border-brand-orange bg-brand-orange-light px-4 py-3 text-sm text-ink"
        >
          <strong className="font-semibold">Escalated to unit head</strong>{" "}
          <Ago at={ticket.escalatedToHeadAt} />:{" "}
          <span className="whitespace-pre-line">
            {ticket.escalatedToHeadReason}
          </span>
        </p>
      )}
      {actions.isError && (
        <p role="alert" className="text-sm text-danger">
          {actions.error.message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <h2 className="sr-only">Description</h2>
            <RichTextView html={ticket.descriptionHtml} />
            {ticket.attachments.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold">Files</h3>
                <AttachmentList
                  ticketId={ticket.id}
                  files={ticket.attachments}
                  label="Ticket files"
                />
              </div>
            )}
          </Card>

          {showTasks && <TasksPanel ticket={ticket} />}

          <section aria-labelledby="conversation-heading" className="space-y-3">
            <h2 id="conversation-heading" className="text-lg font-semibold">
              Conversation
            </h2>
            <Conversation ticketId={ticket.id} comments={ticket.comments} />
          </section>

          {ticket.canComment ? (
            <ReplyBox key={ticket.id} ticket={ticket} />
          ) : (
            <p className="rounded-card border border-line bg-white px-4 py-3 text-sm text-muted">
              {ticket.status === STATUS.Cancelled
                ? "This ticket is cancelled."
                : "This ticket is closed."}
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold">Details</h2>
            <dl className="space-y-3">
              <Detail label="Requester">
                {personName(ticket.requester)}
                {ticket.requesterDepartment && (
                  <span className="block text-xs text-muted">
                    {ticket.requesterDepartment}
                  </span>
                )}
                {ticket.isStaffView && (
                  <RequesterSaid options={priorityOptions.data} />
                )}
              </Detail>
              {raisedForSomeoneElse && (
                <Detail label="Raised by">{personName(ticket.raisedBy)}</Detail>
              )}
              <Detail label="Copied">
                {ticket.cc.length ? (
                  <ul>
                    {ticket.cc.map((person) => (
                      <li key={person.userId}>
                        {personName(person)}
                        {person.userId === ticket.assignee?.userId &&
                          ", copied · handling it"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">No one</span>
                )}
              </Detail>
              <Detail label="Raised">{formatWat(ticket.createdAt)}</Detail>
              <Detail label="First response">
                <span data-testid="detail-first-response">
                  {ticket.firstRespondedAt ? (
                    formatWat(ticket.firstRespondedAt)
                  ) : ticket.assignee ? (
                    <Chip tone="orange">Waiting</Chip>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </span>
              </Detail>
              {ticket.slaDueAt && (
                <Detail label="Due">
                  <DueTime at={ticket.slaDueAt} full />
                </Detail>
              )}
              <Detail label="Updated">
                {ticket.updatedAt ? formatWat(ticket.updatedAt) : "—"}
              </Detail>
            </dl>
          </Card>
          <PickCard ticket={ticket} />
          {actions.data && (
            <ActionsCard
              ticket={ticket}
              actions={actions.data}
              isRequester={isRequester}
            />
          )}
          {ticket.isStaffView && <AssignmentPanel ticket={ticket} />}
          {ticket.isStaffView && <LinkedTickets ticket={ticket} />}
        </aside>
      </div>
    </div>
  );
}
