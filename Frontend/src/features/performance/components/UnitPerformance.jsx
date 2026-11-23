import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, FileBarChart2, ShieldOff } from "lucide-react";
import {
  BarList,
  MEASURE_COLOR,
  PRIORITY_COLOR,
  stepColor,
  TimeChart,
} from "@/shared/charts";
import { MessageCard, Spinner } from "@/shared/ui";
import {
  axisLabel,
  bucketLabel,
  formatHours,
  formatPercent,
  periodText,
  targetsText,
} from "../format.js";
import { HELP } from "../help.js";
import { usePeriod, useUnitPerformance } from "../hooks/usePerformance.js";
import ChartCard from "./ChartCard.jsx";
import Figure from "./Figure.jsx";
import MembersTable from "./MembersTable.jsx";
import PeriodPicker from "./PeriodPicker.jsx";
import PersonPanel from "./PersonPanel.jsx";

/** Open-ticket statuses as the ticket list filters them (?status=). */
const STATUS_CODE = {
  new: 1,
  assigned: 2,
  "in progress": 3,
  pending: 4,
  reopened: 6,
};

const GUIDE = 90;
const GUIDE_NOTE =
  "Guide 90% is a visual guide only: the real targets are times (respond and resolve within so many business hours), not a percentage.";

const quiet =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-brand-navy hover:border-brand-navy";

/** "Save as report" and "Schedule": the Reports page with the matching ready-made report. */
function ReportActions({ code, unitId, unitName }) {
  const to = (action) =>
    `/reports?unit=${unitId}&report=${code}&action=${action}`;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Link to={to("save")} state={{ unitName }} className={quiet}>
        <FileBarChart2 aria-hidden="true" size={14} />
        Save as report
      </Link>
      <Link to={to("schedule")} state={{ unitName }} className={quiet}>
        <CalendarClock aria-hidden="true" size={14} />
        Schedule
      </Link>
    </div>
  );
}

/**
 * A unit's performance on its dashboard (head, HOD, Department Admin, Super Admin): the figures,
 * raised against resolved and the within-time share over time, the members compared (a name opens
 * that person in a side panel; not for a member without a userId), open tickets by status (opens
 * the unit's list with that status), priority and age (highlighted only: the list cannot filter
 * by them), the busiest categories and a sortable members table. `queueLink(filter)` is the unit's
 * ticket list with extra query text.
 */
export default function UnitPerformance({ unitId, unitName, queueLink }) {
  const navigate = useNavigate();
  const [period, setPeriod] = usePeriod();
  const query = useUnitPerformance(unitId, period);
  const [person, setPerson] = useState(null);
  const [lit, setLit] = useState(null);

  let body;
  if (query.isLoading) {
    body = (
      <div className="py-8 text-center text-muted">
        <Spinner label="Loading the unit's figures…" />
      </div>
    );
  } else if (query.isError && !query.data) {
    body =
      query.error.status === 403 ? (
        <MessageCard icon={ShieldOff} title="You are not allowed to see this">
          <p>
            A unit&apos;s performance is for the head of the unit, the Head of
            Department, the Department Admin and Super Admin.
          </p>
        </MessageCard>
      ) : (
        <p role="alert" className="text-sm text-danger">
          {query.error.message}
        </p>
      );
  } else if (!query.data) {
    body = <p className="text-sm text-muted">Choose both dates.</p>;
  } else {
    body = (
      <UnitBody
        data={query.data}
        unitName={unitName}
        stale={query.isFetching}
        error={query.isError ? query.error.message : null}
        lit={lit}
        onPerson={setPerson}
        onStatus={(label) => {
          const code = STATUS_CODE[label.toLowerCase()];
          if (code) navigate(queueLink(`&status=${code}`));
        }}
        onHighlight={(key) =>
          setLit((current) => (current === key ? null : key))
        }
      />
    );
  }

  return (
    <section
      aria-labelledby="unit-performance"
      data-testid="unit-performance"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="unit-performance" className="text-lg font-semibold">
            Performance
          </h2>
          <p className="text-sm text-muted">
            How {unitName} is doing. All times are business hours.
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {body}
      {person && (
        <PersonPanel
          member={person}
          period={period}
          onClose={() => setPerson(null)}
        />
      )}
    </section>
  );
}

function UnitBody({
  data,
  unitName,
  stale,
  error,
  lit,
  onPerson,
  onStatus,
  onHighlight,
}) {
  const { figures, series, period } = data;
  const labels = series.map((p) => axisLabel(p.date, period.bucket));
  const titles = series.map((p) => bucketLabel(p.date, period.bucket));
  const members = [...data.members].sort(
    (a, b) =>
      b.figures.resolved - a.figures.resolved || a.name.localeCompare(b.name),
  );
  const select = (m) => (m.userId ? () => onPerson(m) : undefined);
  const memberRow = (m, i) => ({
    key: m.userId ?? `gone-${i}`,
    label: m.name,
    sub: m.isHead ? "Head" : undefined,
    onSelect: select(m),
  });
  const lines = targetsText(data.targets);
  const priorityNote =
    "The ticket list cannot filter by priority yet, so a bar is highlighted only.";
  const ageNote =
    "The ticket list cannot filter by age yet, so a bar is highlighted only.";

  return (
    <div
      className={`space-y-4 ${stale ? "opacity-70 transition-opacity" : ""}`}
    >
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p data-testid="performance-period" className="text-xs text-muted">
        {periodText(period)}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Figure
          label="Assigned"
          value={figures.assigned}
          help={HELP.assigned}
          testId="unit-assigned"
        />
        <Figure
          label="Resolved"
          value={figures.resolved}
          help={HELP.resolved}
          testId="unit-resolved"
        />
        <Figure
          label="Open now"
          value={figures.openNow}
          help={HELP.openNow}
          testId="unit-openNow"
        />
        <Figure
          label="On hold"
          value={figures.onHold}
          help={HELP.onHold}
          testId="unit-onHold"
        />
        <Figure
          label="Within time"
          value={formatPercent(figures.withinSlaPercent)}
          help={HELP.withinTime}
          testId="unit-within"
        />
        <Figure
          label="Answered in time"
          value={formatPercent(figures.respondedInTimePercent)}
          help={HELP.answeredInTime}
          testId="unit-answered"
        />
        <Figure
          label="Avg time to resolve"
          value={formatHours(figures.avgResolutionHours)}
          help={HELP.avgResolution}
          testId="unit-avgResolution"
        />
        <Figure
          label="Avg first response"
          value={formatHours(figures.avgFirstResponseHours)}
          help={HELP.avgFirstResponse}
          testId="unit-avgFirstResponse"
        />
        <Figure
          label="Reopened"
          value={formatPercent(figures.reopenedPercent)}
          help={HELP.reopened}
          testId="unit-reopened"
        />
      </ul>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Raised and resolved"
          help="Raised: tickets raised in each bucket. Resolved: counted by the date each was resolved."
        >
          <TimeChart
            testId="chart-raised-resolved"
            label="Raised and resolved over time"
            labels={labels}
            titles={titles}
            series={[
              {
                key: "raised",
                label: "Raised",
                color: MEASURE_COLOR.raised,
                values: series.map((p) => p.raised),
              },
              {
                key: "resolved",
                label: "Resolved",
                color: MEASURE_COLOR.resolved,
                values: series.map((p) => p.resolved),
              },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Within time"
          help={`${HELP.withinTime} A point only where something was resolved; a dashed line crosses buckets with nothing to measure.`}
        >
          <TimeChart
            testId="chart-unit-within"
            label="Share resolved within time over time"
            kind="line"
            type="percent"
            format={formatPercent}
            labels={labels}
            titles={titles}
            series={[
              {
                key: "within",
                label: "Within time",
                color: MEASURE_COLOR.within,
                values: series.map((p) => p.withinSlaPercent),
              },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          testId="chart-members"
          title="Case workers compared"
          help={`${HELP.resolved} Open now is right now, with On hold (striped) inside it. Select a name to see that person.`}
          actions={
            <ReportActions
              code="R10"
              unitId={data.unitId}
              unitName={unitName}
            />
          }
        >
          <BarList
            label="Resolved and open now per member"
            rows={members.map((m, i) => ({
              ...memberRow(m, i),
              values: {
                resolved: m.figures.resolved,
                active: Math.max(0, m.figures.openNow - m.figures.onHold),
                onHold: m.figures.onHold,
              },
            }))}
            bars={[
              {
                key: "resolved",
                label: "Resolved",
                segments: [
                  {
                    key: "resolved",
                    label: "Resolved",
                    color: MEASURE_COLOR.resolved,
                  },
                ],
              },
              {
                key: "open",
                label: "Open now",
                segments: [
                  {
                    key: "active",
                    label: "Open, being worked",
                    color: MEASURE_COLOR.open,
                  },
                  {
                    key: "onHold",
                    label: "On hold",
                    color: MEASURE_COLOR.onHold,
                    hatched: true,
                  },
                ],
              },
            ]}
            emptyText="Nobody has tickets in this period"
          />
        </ChartCard>
        <ChartCard
          testId="chart-members-within"
          title="Within time per member"
          help={`${HELP.withinTime} ${GUIDE_NOTE}`}
          actions={
            <ReportActions code="R3" unitId={data.unitId} unitName={unitName} />
          }
        >
          <BarList
            label="Share resolved within time per member"
            rows={members.map((m, i) => ({
              ...memberRow(m, i),
              values: { within: m.figures.withinSlaPercent },
              extra: [{ label: "Resolved", value: String(m.figures.resolved) }],
            }))}
            bars={[
              {
                key: "within",
                label: "Within time",
                segments: [
                  {
                    key: "within",
                    label: "Within time",
                    color: MEASURE_COLOR.within,
                  },
                ],
              },
            ]}
            max={100}
            format={formatPercent}
            reference={{
              value: GUIDE,
              label: "Guide 90% (a visual guide; the real targets are times)",
              note: GUIDE_NOTE,
            }}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          testId="chart-by-status"
          title="Open by status"
          help="Open right now. Select a status to open the unit's list with it."
        >
          <BarList
            label="Open tickets by status"
            rows={data.openByStatus.map((c, i, all) => ({
              key: c.label,
              label: c.label,
              color: stepColor(i, all.length),
              values: { count: c.count },
              onSelect: STATUS_CODE[c.label.toLowerCase()]
                ? () => onStatus(c.label)
                : undefined,
            }))}
            bars={[
              {
                key: "count",
                label: "Open",
                segments: [
                  { key: "count", label: "Open", color: MEASURE_COLOR.tickets },
                ],
              },
            ]}
            emptyText="Nothing open right now"
          />
        </ChartCard>
        <ChartCard
          testId="chart-by-priority"
          title="Open by priority"
          help={`Open right now. ${priorityNote}`}
        >
          <BarList
            label="Open tickets by priority"
            highlight={lit}
            rows={data.openByPriority.map((c) => ({
              key: `priority-${c.label}`,
              label: c.label,
              color: PRIORITY_COLOR[c.label] ?? MEASURE_COLOR.tickets,
              values: { count: c.count },
              onSelect: () => onHighlight(`priority-${c.label}`),
            }))}
            bars={[
              {
                key: "count",
                label: "Open",
                segments: [
                  { key: "count", label: "Open", color: MEASURE_COLOR.tickets },
                ],
              },
            ]}
            emptyText="Nothing open right now"
          />
        </ChartCard>
        <ChartCard
          testId="chart-by-age"
          title="Open by age"
          help={`Open right now, by how long ago each was raised. ${ageNote}`}
        >
          <BarList
            label="Open tickets by age"
            highlight={lit}
            rows={data.openByAge.map((c, i, all) => ({
              key: `age-${c.label}`,
              label: c.label,
              color: stepColor(i, all.length),
              values: { count: c.count },
              onSelect: () => onHighlight(`age-${c.label}`),
            }))}
            bars={[
              {
                key: "count",
                label: "Open",
                segments: [
                  { key: "count", label: "Open", color: MEASURE_COLOR.tickets },
                ],
              },
            ]}
            emptyText="Nothing open right now"
          />
        </ChartCard>
      </div>
      {lit && (
        <p role="status" className="text-xs text-muted">
          {lit.startsWith("priority-") ? priorityNote : ageNote}
        </p>
      )}

      <ChartCard
        testId="chart-categories"
        title="Busiest categories"
        help="Tickets per category in the period (the top 8), with the average time to resolve and the within-time share."
      >
        <BarList
          label="Tickets per category"
          rows={data.categories.map((c) => ({
            key: c.name,
            label: c.name,
            values: { tickets: c.tickets },
            extra: [
              {
                label: "Avg time to resolve",
                value: formatHours(c.avgResolutionHours),
              },
              {
                label: "Within time",
                value: formatPercent(c.withinSlaPercent),
              },
            ],
          }))}
          bars={[
            {
              key: "tickets",
              label: "Tickets",
              segments: [
                {
                  key: "tickets",
                  label: "Tickets",
                  color: MEASURE_COLOR.tickets,
                },
              ],
            },
          ]}
        />
      </ChartCard>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Members</h3>
        <MembersTable members={data.members} onSelect={onPerson} />
      </div>
      {lines.length > 0 && (
        <p className="text-xs text-muted">
          Targets (business hours): {lines.join(" · ")}.
        </p>
      )}
    </div>
  );
}
