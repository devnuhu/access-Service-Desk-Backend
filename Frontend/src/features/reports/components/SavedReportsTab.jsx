import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Mail, Play, Search } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import {
  Button,
  Chip,
  ConfirmDialog,
  Pager,
  Spinner,
  useToast,
} from "@/shared/ui";
import { roleLabel } from "@/shared/lib/roles";
import {
  downloadReport,
  useDeleteSavedReport,
  useRefreshSavedReports,
  useSavedReports,
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

const SCOPES = [
  ["mine", "Mine"],
  ["shared", "Shared with me"],
];

const EMPTY = {
  mine: "None yet. Run a ready-made report and save it as your own.",
  shared: "No one has shared a report with you.",
};

/**
 * One scope of saved reports (GET /api/reports/saved?scope=): its own search (on the server, over
 * the name, description and owner of every report in the scope), 10 a page, and the shared pager.
 */
function SavedReportList({ scope, schedules, onEmailMe, onRun, onEdit }) {
  const toast = useToast();
  const remove = useDeleteSavedReport();
  const refreshSaved = useRefreshSavedReports();
  const [deleting, setDeleting] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const paging = usePaging(search);
  const savedReports = useSavedReports({
    scope,
    search,
    page: paging.page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, savedReports.data?.total);
  const items = savedReports.data?.items ?? [];
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

  return (
    <div data-testid={`saved-${scope}`}>
      <div className="px-5 py-3">
        <div className="relative max-w-md">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            aria-label="Search saved reports"
            placeholder="Name, description or owner"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-sm text-ink"
          />
        </div>
      </div>
      {savedReports.isLoading ? (
        <div className="border-t border-line px-5 py-10 text-center text-muted">
          <Spinner label="Loading saved reports…" />
        </div>
      ) : savedReports.isError ? (
        <p
          role="alert"
          className="border-t border-line px-5 py-10 text-center text-sm text-danger"
        >
          {savedReports.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="border-t border-line px-5 py-6 text-sm text-muted">
          {search ? "No saved reports match." : EMPTY[scope]}
        </p>
      ) : (
        <>
          <ul
            className={`divide-y divide-line border-t border-line ${savedReports.isPlaceholderData ? "opacity-60" : ""}`}
          >
            {items.map((report) => (
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
            ))}
          </ul>
          <div className="border-t border-line px-5 py-3">
            <Pager
              total={savedReports.data.total}
              page={paging.page}
              onPage={paging.setPage}
            />
          </div>
        </>
      )}

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
    </div>
  );
}

/**
 * Saved reports in two tabs, Mine and Shared with me, each its own call (scope=mine / shared) with
 * its own search, pager and total. The tab is kept in the address (?saved=shared). Run, download,
 * have it emailed to you; your own ones also edit and delete (their email schedules go with them).
 */
export default function SavedReportsTab({
  schedules,
  onEmailMe,
  onRun,
  onEdit,
}) {
  const [params, setParams] = useSearchParams();
  const scope = params.get("saved") === "shared" ? "shared" : "mine";
  const choose = (next) =>
    setParams(
      (current) => {
        const url = new URLSearchParams(current);
        if (next === "shared") url.set("saved", "shared");
        else url.delete("saved");
        return url;
      },
      { replace: true },
    );

  return (
    <section aria-labelledby="saved-reports" className="border-t border-line">
      <h2 id="saved-reports" className="px-5 pt-4 text-base font-semibold">
        Saved reports
      </h2>
      <div
        role="tablist"
        aria-label="Whose reports"
        className="mt-2 flex gap-1 border-b border-line px-3"
      >
        {SCOPES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={scope === id}
            onClick={() => choose(id)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-semibold ${scope === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <SavedReportList
        key={scope}
        scope={scope}
        schedules={schedules}
        onEmailMe={onEmailMe}
        onRun={onRun}
        onEdit={onEdit}
      />
    </section>
  );
}
