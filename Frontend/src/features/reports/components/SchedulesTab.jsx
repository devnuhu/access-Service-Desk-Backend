import { useState } from "react";
import { Plus, TriangleAlert, Users } from "lucide-react";
import {
  Button,
  Chip,
  ConfirmDialog,
  Spinner,
  Switch,
  useToast,
} from "@/shared/ui";
import { formatWat } from "@/shared/lib/time";
import { useDeleteSchedule, useUpdateSchedule } from "../hooks/useReports.js";
import {
  describeSchedule,
  FORMAT_LABELS,
  MAX_SCHEDULES,
  STATUS,
  toBody,
} from "../schedule.js";

function LastResult({ schedule }) {
  const status = STATUS[schedule.lastStatus];
  if (!schedule.lastStatus) return <span className="text-muted">Not yet</span>;
  return (
    <div className="max-w-64">
      <Chip tone={status?.tone ?? "grey"}>
        {status?.label ?? schedule.lastStatus}
      </Chip>
      {schedule.lastStatus === "Sent" && schedule.lastSentAt && (
        <p className="mt-1 text-xs text-muted">
          {formatWat(schedule.lastSentAt)}
        </p>
      )}
      {/* Sent to the owner, but a copy failed: a warning, not a failure. */}
      {schedule.lastStatus === "Sent" && schedule.lastError && (
        <p
          data-testid="copy-warning"
          className="mt-1 flex items-start gap-1 text-xs font-medium text-brand-orange-ink"
        >
          <TriangleAlert
            aria-hidden="true"
            size={13}
            className="mt-px shrink-0"
          />
          {schedule.lastError}
        </p>
      )}
      {schedule.lastStatus !== "Sent" && (
        <p className="mt-1 text-xs text-muted">
          {schedule.lastError || status?.help}
        </p>
      )}
    </div>
  );
}

/** Your report emails: what is sent, when next, the last result; switch, change or delete. */
export default function SchedulesTab({ schedules, onAdd, onEdit, canAdd }) {
  const toast = useToast();
  const update = useUpdateSchedule();
  const remove = useDeleteSchedule();
  const [switching, setSwitching] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const list = schedules.data ?? [];
  const full = list.length >= MAX_SCHEDULES;

  const toggle = async (schedule, enabled) => {
    setSwitching(schedule.id);
    try {
      const saved = await update.mutateAsync({
        id: schedule.id,
        body: toBody({ ...schedule, enabled }),
      });
      toast.success(
        saved.nextRunAt
          ? `Next email: ${formatWat(saved.nextRunAt)}.`
          : "Switched off. Nothing will be sent until you switch it on.",
        { title: `${schedule.reportName} switched ${enabled ? "on" : "off"}` },
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSwitching(null);
    }
  };

  const confirmDelete = async () => {
    try {
      const result = await remove.mutateAsync(deleting.id);
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-muted">
          Sent to you. Shows only what you are allowed to see. Times are Lagos
          time.
        </p>
        <Button
          size="sm"
          onClick={onAdd}
          disabled={full || !canAdd}
          title={
            full
              ? `You have ${MAX_SCHEDULES} schedules. Delete one first.`
              : undefined
          }
        >
          <Plus aria-hidden="true" size={16} />
          Add schedule
        </Button>
      </div>
      {full && (
        <p className="border-b border-line bg-page px-5 py-2 text-xs text-body">
          You have {MAX_SCHEDULES} schedules, the most allowed. Delete one to
          add another.
        </p>
      )}

      {schedules.isLoading ? (
        <div className="px-5 py-10 text-center text-muted">
          <Spinner label="Loading schedules…" />
        </div>
      ) : schedules.isError ? (
        <p role="alert" className="px-5 py-10 text-center text-sm text-danger">
          {schedules.error.message}
        </p>
      ) : !list.length ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          No report emails yet. Add one, or choose “Email me this report” on a
          saved report.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-page/60 text-[12px] font-semibold tracking-wider text-muted uppercase">
              <tr>
                <th scope="col" className="px-5 py-4">
                  Report
                </th>
                <th scope="col" className="px-5 py-4">
                  How often
                </th>
                <th scope="col" className="px-5 py-4">
                  File
                </th>
                <th scope="col" className="px-5 py-4">
                  Next email
                </th>
                <th scope="col" className="px-5 py-4">
                  Last result
                </th>
                <th scope="col" className="px-5 py-4">
                  On
                </th>
                <th scope="col" className="px-5 py-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((schedule) => (
                <tr
                  key={schedule.id}
                  data-testid={`schedule-${schedule.reportName}`}
                  className="align-top"
                >
                  <td className="px-5 py-3 font-semibold text-ink">
                    {schedule.reportName}
                  </td>
                  <td className="px-5 py-3">
                    {describeSchedule(schedule)}
                    {schedule.cc.length > 0 && (
                      <span
                        data-testid="copied-to"
                        title={schedule.cc.map((p) => p.name).join(", ")}
                        className="mt-1 flex items-center gap-1 text-xs text-muted"
                      >
                        <Users aria-hidden="true" size={13} />
                        Copied to {schedule.cc.length}{" "}
                        {schedule.cc.length === 1 ? "person" : "people"}
                        <span className="sr-only">
                          : {schedule.cc.map((p) => p.name).join(", ")}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {FORMAT_LABELS[schedule.format] ?? schedule.format}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {schedule.nextRunAt ? (
                      formatWat(schedule.nextRunAt)
                    ) : (
                      <Chip tone="grey">Off</Chip>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <LastResult schedule={schedule} />
                  </td>
                  <td className="px-5 py-3">
                    <Switch
                      checked={schedule.enabled}
                      disabled={switching === schedule.id}
                      onChange={(enabled) => toggle(schedule, enabled)}
                      aria-label={`Send ${schedule.reportName}`}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onEdit(schedule)}
                      >
                        Edit{" "}
                        <span className="sr-only">{schedule.reportName}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleting(schedule)}
                      >
                        Delete{" "}
                        <span className="sr-only">{schedule.reportName}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete the email for ${deleting?.reportName}?`}
        message="You will stop getting this report by email. The saved report stays."
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
