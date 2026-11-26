import {
  MEASURE_COLOR,
  StackedBar,
  stepColor,
  TimeChart,
} from "@/shared/charts";
import {
  axisLabel,
  bucketLabel,
  formatPercent,
  mediumTarget,
  periodText,
  targetsText,
} from "../format.js";
import { formatShare } from "../headline.js";
import { HELP } from "../help.js";
import ChartCard from "./ChartCard.jsx";
import Figure from "./Figure.jsx";
import HeadlinePanel from "./HeadlinePanel.jsx";
import TargetTile from "./TargetTile.jsx";
import TaskFigures from "./TaskFigures.jsx";

const BUCKET_WORD = { day: "day", week: "week", month: "month" };

/**
 * One person's performance (their own on the dashboard, or one of a head's people in the side
 * panel): the six headline indicators, then the detail: assigned and reopened, first response and
 * resolution against the Medium target and the team, ticket tasks (on time, rejections and why),
 * assigned and resolved over time, within-time share over time, and what is open now by status.
 */
export default function PersonPerformance({ data }) {
  const { figures, team, series, period, targets } = data;
  const medium = mediumTarget(targets);
  const lines = targetsText(targets);
  const labels = series.map((p) => axisLabel(p.date, period.bucket));
  const titles = series.map((p) => bucketLabel(p.date, period.bucket));
  const per = BUCKET_WORD[period.bucket] ?? "period";

  return (
    <div className="@container space-y-4">
      <p data-testid="performance-period" className="text-xs text-muted">
        {periodText(period)} · by {per} · all times are business hours
      </p>
      <HeadlinePanel figures={figures} testId="perf-headline" />

      <h3 className="pt-1 text-sm font-semibold text-ink">Detail</h3>
      <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <Figure
          label="Assigned"
          value={figures.assigned}
          help={HELP.assigned}
          testId="perf-assigned"
        />
        <Figure
          label="Reopened"
          value={`${figures.reopened} (${formatShare(figures.reopenedPercent)})`}
          help={HELP.reopened}
          testId="perf-reopened"
        />
      </ul>

      <div className="grid gap-3 @2xl:grid-cols-2">
        <TargetTile
          title="First response"
          help={HELP.avgFirstResponse}
          mine={figures.avgFirstResponseHours}
          team={team?.avgFirstResponseHours ?? null}
          target={medium?.responseHours ?? null}
          targetLines={lines}
          percentLabel="Answered in time"
          percent={figures.respondedInTimePercent}
          testId="first-response"
        />
        <TargetTile
          title="Resolution"
          help={HELP.avgResolution}
          mine={figures.avgResolutionHours}
          team={team?.avgResolutionHours ?? null}
          target={medium?.resolutionHours ?? null}
          targetLines={lines}
          percentLabel="Within time"
          percent={figures.withinSlaPercent}
          testId="resolution"
        />
      </div>

      <TaskFigures tasks={data.tasks} rejections={data.taskRejections} />

      <div className="grid gap-3 @5xl:grid-cols-2">
        <ChartCard
          title="Assigned and resolved"
          help={`${HELP.assigned} ${HELP.resolved}`}
        >
          <TimeChart
            testId="chart-assigned-resolved"
            label={`Assigned and resolved by ${per}`}
            labels={labels}
            titles={titles}
            series={[
              {
                key: "assigned",
                label: "Assigned",
                color: MEASURE_COLOR.assigned,
                values: series.map((p) => p.assigned),
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
            testId="chart-within"
            label={`Share resolved within time by ${per}`}
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

      <ChartCard title="Open now by status" help={HELP.openNow}>
        <StackedBar
          testId="chart-open-status"
          label="Open tickets by status"
          items={data.openByStatus.map((c, i, all) => ({
            key: c.label,
            label: c.label,
            count: c.count,
            color: stepColor(i, all.length),
          }))}
        />
      </ChartCard>

      {lines.length > 0 && (
        <p data-testid="targets-line" className="text-xs text-muted">
          Targets (business hours): {lines.join(" · ")}.
        </p>
      )}
    </div>
  );
}
