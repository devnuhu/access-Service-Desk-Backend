import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Filter, ShieldOff } from "lucide-react";
import { useSession } from "@/features/auth";
import {
  headedUnits,
  oversees,
  unitPlace,
  useMyOrganisation,
} from "@/features/org";
import {
  Card,
  MessageCard,
  useToast,
  PageHeader,
  UnitEyebrow,
} from "@/shared/ui";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { formatWat } from "@/shared/lib/time";
import ReadyMadeReports from "../components/ReadyMadeReports.jsx";
import RunReportDialog from "../components/RunReportDialog.jsx";
import SaveReportDialog from "../components/SaveReportDialog.jsx";
import SavedReportsTab from "../components/SavedReportsTab.jsx";
import ScheduleDialog from "../components/ScheduleDialog.jsx";
import SchedulesTab from "../components/SchedulesTab.jsx";
import {
  useReportCatalogue,
  useReportSchedules,
  useSavedReports,
} from "../hooks/useReports.js";

const TABS = [
  ["saved", "Saved reports"],
  ["schedules", "Schedules"],
];

/**
 * Reports (unit heads, HODs, Department Admins, Super Admin): the ready-made reports from the
 * catalogue, saved reports, and the ones you have emailed to you on a schedule. ?tab=schedules
 * opens the schedules. ?unit= (a unit dashboard's "Unit reports") runs the ready-made reports for
 * that unit only: unitIds in the definition; the unit's name comes in the link's state.
 * ?report=R10&action=save|schedule (the unit dashboard's performance charts) opens "Save as my
 * report" for that ready-made report, or saves it and then opens the schedule dialog.
 */
export default function ReportsPage() {
  const toast = useToast();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "schedules" ? "schedules" : "saved";
  const unitId = params.get("unit");
  const org = useMyOrganisation();
  // The unit these reports are about: the one asked for, or the only unit a head runs.
  const headed = headedUnits(org.data);
  const pageUnitId =
    unitId ??
    (headed.length === 1 && !oversees(org.data, false) ? headed[0].id : null);
  const place = pageUnitId ? unitPlace(org.data, pageUnitId) : null;
  const unitName =
    useLocation().state?.unitName ?? place?.unitName ?? "one unit";
  // Ready-made reports for the chosen unit only.
  const forUnit = (definition) =>
    unitId ? { ...definition, unitIds: [unitId] } : definition;
  const savedReports = useSavedReports();
  const schedules = useReportSchedules();
  const catalogue = useReportCatalogue();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  // { schedule } to change one, { savedReportId } to add one (may be "").
  const [dialog, setDialog] = useState(null);
  // The report on screen: { title, description, definition, saved? }.
  const [running, setRunning] = useState(null);
  // "Save as my report": { definition, defaultName, defaultDescription, thenEmail }; Edit: { report }.
  const [saving, setSaving] = useState(null);

  const scheduleList = schedules.data ?? [];

  const setTab = (id) =>
    setParams(
      {
        ...(id === "saved" ? {} : { tab: id }),
        ...(unitId ? { unit: unitId } : {}),
      },
      { replace: true },
    );

  // One schedule per report: "Email me this report" on a scheduled report opens that schedule.
  const emailMe = (report, schedule) =>
    setDialog(schedule ? { schedule } : { savedReportId: report.id });

  const runBuiltIn = (report) =>
    setRunning({
      title: report.name,
      description: report.description,
      definition: forUnit(report.definition),
    });

  const runSaved = (report) =>
    setRunning({
      title: report.name,
      description: report.description ?? undefined,
      definition: report.definition ?? {},
      saved: report,
    });

  // A copy of your own report needs a new name (names are unique per person).
  const saveRunning = (definition) =>
    setSaving({
      definition,
      defaultName: running.saved?.isMine
        ? `${running.title} (copy)`
        : running.title,
      defaultDescription: running.description ?? "",
      thenEmail: false,
    });

  // Saved first (a schedule sends a saved report), then the schedule dialog opens with it chosen.
  const saveAndEmail = (report, scheduleDefaults) =>
    setSaving({
      definition: forUnit(report.definition),
      defaultName: unitId ? `${report.name} (${unitName})` : report.name,
      defaultDescription: report.description,
      thenEmail: true,
      scheduleDefaults,
    });
  // The daily team report: every working day at 17:00; heads can then add people to copy.
  const emailDaily = (report) =>
    saveAndEmail(report, { frequency: "daily", sendHour: 17 });

  // A link asked for a ready-made report: once the catalogue is in, open its save (or save and
  // schedule) dialog, once; then the link's report and action are dropped from the address.
  const askedReport = params.get("report");
  const askedAction = params.get("action");
  const [handled, setHandled] = useState(null);
  const ask = askedReport ? `${askedReport}|${askedAction}` : null;
  if (ask && catalogue.data && handled !== ask) {
    setHandled(ask);
    const report = catalogue.data.builtIn.find((r) => r.code === askedReport);
    if (report && askedAction === "schedule") saveAndEmail(report);
    else if (report)
      setSaving({
        definition: forUnit(report.definition),
        defaultName: unitId ? `${report.name} (${unitName})` : report.name,
        defaultDescription: report.description,
        thenEmail: false,
      });
  }
  useEffect(() => {
    if (!handled) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("report");
        next.delete("action");
        return next;
      },
      { replace: true },
    );
  }, [handled, setParams]);

  const reportSaved = (report) => {
    const { thenEmail, report: edited, scheduleDefaults } = saving;
    setSaving(null);
    if (edited) {
      toast.success("Your changes are saved.", { title: report.name });
    } else if (thenEmail) {
      toast.success("Now choose when it is emailed to you.", {
        title: `${report.name} saved`,
      });
      setDialog({ savedReportId: report.id, defaults: scheduleDefaults });
    } else {
      toast.success("It is in your saved reports.", {
        title: `${report.name} saved`,
      });
    }
  };

  const saved = (schedule) => {
    setDialog(null);
    toast.success(
      schedule.nextRunAt
        ? `The first email goes out ${formatWat(schedule.nextRunAt)}.`
        : "It is switched off, so nothing will be sent until you switch it on.",
      { title: `${schedule.reportName} saved` },
    );
  };

  // Reports are for unit heads, HODs, Department Admins and Super Admin: the server says 403.
  if (catalogue.error?.status === 403 || savedReports.error?.status === 403) {
    return (
      <MessageCard
        icon={ShieldOff}
        title="Reports are not available for your role."
      >
        <p>
          Reports are for unit heads, Heads of Department, Department Admins and
          Super Admin.
        </p>
      </MessageCard>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          place?.unitName ? (
            <UnitEyebrow
              unitName={place.unitName}
              departmentName={place.departmentName}
            />
          ) : undefined
        }
        title="Reports"
        description="Ready-made reports, your saved reports and the ones shared with you. Shows only what you are allowed to see."
      />

      {unitId && (
        <div
          data-testid="report-unit"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-navy/20 bg-brand-navy-light px-5 py-3 text-sm"
        >
          <p className="flex items-center gap-2 text-ink">
            <Filter aria-hidden="true" size={16} className="text-brand-navy" />
            Ready-made reports run for <strong>{unitName}</strong> only.
          </p>
          <Link
            to="/reports"
            className="font-semibold text-brand-navy hover:underline"
          >
            Show every unit
          </Link>
        </div>
      )}

      <Card>
        <div
          role="tablist"
          aria-label="Reports"
          className="flex gap-1 border-b border-line px-3 pt-2"
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div key={tab} className="tab-in">
          {tab === "saved" ? (
            <>
              <ReadyMadeReports
                catalogue={catalogue}
                onRun={runBuiltIn}
                onSaveAndEmail={(report) => saveAndEmail(report)}
                onEmailDaily={emailDaily}
              />
              <SavedReportsTab
                savedReports={savedReports}
                schedules={scheduleList}
                onEmailMe={emailMe}
                onRun={runSaved}
                onEdit={(report) => setSaving({ report })}
              />
            </>
          ) : (
            <SchedulesTab
              schedules={schedules}
              canAdd={Boolean(savedReports.data?.length)}
              onAdd={() => setDialog({ savedReportId: "" })}
              onEdit={(schedule) => setDialog({ schedule })}
            />
          )}
        </div>
      </Card>

      {running && (
        <RunReportDialog
          report={running}
          presets={catalogue.data?.presets ?? []}
          measures={catalogue.data?.measures ?? []}
          onSave={saveRunning}
          onClose={() => setRunning(null)}
        />
      )}
      {saving && (
        <SaveReportDialog
          {...saving}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setSaving(null)}
          onSaved={reportSaved}
        />
      )}
      {dialog && (
        <ScheduleDialog
          schedule={dialog.schedule}
          savedReportId={dialog.savedReportId}
          defaults={dialog.defaults}
          savedReports={savedReports.data ?? []}
          scheduledReportIds={scheduleList.map((s) => s.savedReportId)}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
