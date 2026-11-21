import { useState } from "react";
import { Download, Mail, Play } from "lucide-react";
import { Button, Chip, ConfirmDialog, Spinner, useToast } from "@/shared/ui";
import { roleLabel } from "@/shared/lib/roles";
import {
  downloadReport,
  useDeleteSavedReport,
  useRefreshSavedReports,
} from "../hooks/useReports.js";
import { describeSchedule } from "../schedule.js";
import { isGone } from "../savedReport.js";

/** "Only me", "My unit", "My department", "Head of Unit, HOD". */
function shareText(report) {
  if (report.share === "unit") return "My unit";
  if (report.share === "department") return "My department";
  if (report.share === "roles")
    return report.shareRoles.map(roleLabel).join(", ") || "Selected roles";
  return "Only me";
}

function ReportRow({
  report,
  schedule,
  downloading,
  onRun,
  onDownload,
  onEmailMe,
  onEdit,
  onDelete,
}) {
  return (
    <li
      data-testid={`report-${report.name}`}
      className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
    >
      <div className="min-w-56 flex-1">
        <p className="font-semibold text-ink">{report.name}</p>
        {report.description && (
          <p className="mt-0.5 text-sm text-body">{report.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{report.isMine ? "You" : report.ownerName}</span>
          <Chip tone="grey">Shared with {shareText(report)}</Chip>
          {schedule && (
            <Chip tone={schedule.enabled ? "green" : "grey"}>
              <Mail aria-hidden="true" size={11} />
              {schedule.enabled ? describeSchedule(schedule) : "Email off"}
            </Chip>
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => onRun(report)}>
          <Play aria-hidden="true" size={14} />
          Run <span className="sr-only">{report.name}</span>
        </Button>
        {["xlsx", "csv"].map((format) => (
          <Button
            key={format}
            size="sm"
            variant="secondary"
            busy={downloading === `${report.id}-${format}`}
            onClick={() => onDownload(report, format)}
            aria-label={`Download ${report.name} as ${format === "xlsx" ? "Excel" : "CSV"}`}
          >
            <Download aria-hidden="true" size={14} />
            {format === "xlsx" ? "Excel" : "CSV"}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onEmailMe(report, schedule)}
        >
          <Mail aria-hidden="true" size={14} />
          {schedule ? "Change email" : "Email me this report"}
          <span className="sr-only"> {report.name}</span>
        </Button>
        {report.isMine && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onEdit(report)}
            >
              Edit <span className="sr-only">{report.name}</span>
            </Button>
            <Button size="sm" variant="danger" onClick={() => onDelete(report)}>
              Delete <span className="sr-only">{report.name}</span>
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * My reports and Shared with me (GET /api/reports/saved): run, download, have it emailed to you;
 * your own ones also edit and delete (their email schedules go with them).
 */
export default function SavedReportsTab({
  savedReports,
  schedules,
  onEmailMe,
  onRun,
  onEdit,
}) {
  const toast = useToast();
  const remove = useDeleteSavedReport();
  const refreshSaved = useRefreshSavedReports();
  const [deleting, setDeleting] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const list = savedReports.data ?? [];
  const mine = list.filter((r) => r.isMine);
  const shared = list.filter((r) => !r.isMine);
  const scheduleFor = (reportId) =>
    (schedules ?? []).find((s) => s.savedReportId === reportId);

  const download = async (report, format) => {
    setDownloading(`${report.id}-${format}`);
    try {
      const name = await downloadReport(
        { savedReportId: report.id, title: report.name },
        format,
      );
      toast.success(`${name} downloaded.`);
    } catch (error) {
      if (isGone(error)) refreshSaved();
      toast.error(error.message, { title: `${report.name} not downloaded` });
    } finally {
      setDownloading(null);
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

  const row = (report) => (
    <ReportRow
      key={report.id}
      report={report}
      schedule={scheduleFor(report.id)}
      downloading={downloading}
      onRun={onRun}
      onDownload={download}
      onEmailMe={onEmailMe}
      onEdit={onEdit}
      onDelete={setDeleting}
    />
  );

  if (savedReports.isLoading) {
    return (
      <div className="border-t border-line px-5 py-10 text-center text-muted">
        <Spinner label="Loading saved reports…" />
      </div>
    );
  }
  if (savedReports.isError) {
    return (
      <p
        role="alert"
        className="border-t border-line px-5 py-10 text-center text-sm text-danger"
      >
        {savedReports.error.message}
      </p>
    );
  }

  return (
    <>
      <section aria-labelledby="my-reports" className="border-t border-line">
        <h2 id="my-reports" className="px-5 pt-4 pb-2 text-base font-semibold">
          My reports
        </h2>
        {mine.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {mine.map(row)}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-sm text-muted">
            None yet. Run a ready-made report and save it as your own.
          </p>
        )}
      </section>
      <section
        aria-labelledby="shared-reports"
        className="border-t border-line"
      >
        <h2
          id="shared-reports"
          className="px-5 pt-4 pb-2 text-base font-semibold"
        >
          Shared with me
        </h2>
        {shared.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {shared.map(row)}
          </ul>
        ) : (
          <p className="px-5 pb-4 text-sm text-muted">
            No one has shared a report with you.
          </p>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        message="The report is removed, also for anyone it is shared with. Its email schedules are removed too."
        confirmLabel="Delete report"
        danger
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
