import { useState } from "react";
import { MEASURE_COLOR } from "@/shared/charts";
import { cellValue, formatCell, NUMERIC_TYPES } from "../cells.js";

/**
 * Categorical colours in a fixed order (never cycled), validated for colour-blind separation on
 * white (dataviz validate_palette.js: all checks pass; three slots are under 3:1 contrast, so the
 * table always shows under the chart). A pie past 8 slices folds the rest into "Other" (grey).
 */
const SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];
const OTHER = "#9aa3b2";

/**
 * A measure keeps its colour on every chart (the dashboards too): Resolved, Within time, Assigned,
 * Raised by their label; anything else takes the next slot in order.
 */
function seriesColor(series, k) {
  const label = series.label;
  if (/within/i.test(label)) return MEASURE_COLOR.within;
  if (/^resolved/i.test(label)) return MEASURE_COLOR.resolved;
  if (/^assigned/i.test(label)) return MEASURE_COLOR.assigned;
  if (/^(raised|opened)/i.test(label)) return MEASURE_COLOR.raised;
  return SERIES[k];
}
const GRID = "#e3e8ef";
const AXIS_TEXT = "#6b7a90";

const W = 640;
const H = 260;
const M = { left: 52, right: 12, top: 12, bottom: 44 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const MAX_X_LABELS = 12;

/** 0..max rounded up to 1, 2, 2.5 or 5 x 10^n so the ticks are round numbers. */
function niceMax(max) {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max);
  return step * magnitude;
}

const shorten = (text, size = 14) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

/**
 * What a result can draw: labels from the first column, series from the numeric columns of the
 * same type as the first one (one axis only; the rest stay in the table).
 */
function chartData(result) {
  const [labelColumn, ...rest] = result.columns;
  if (!labelColumn) return null;
  const numeric = rest
    .map((column, i) => ({ column, index: i + 1 }))
    .filter(({ column }) => NUMERIC_TYPES.includes(column.type));
  if (!numeric.length || !result.rows.length) return null;
  const type = numeric[0].column.type;
  const series = numeric
    .filter(({ column }) => column.type === type)
    .map(({ column, index }) => ({
      label: column.label,
      values: result.rows.map((row) => {
        const value = cellValue(row, column, index);
        return typeof value === "number" ? value : null;
      }),
    }));
  const labels = result.rows.map(
    (row) =>
      formatCell(cellValue(row, labelColumn, 0), labelColumn.type) || "(none)",
  );
  return { labels, series, type, labelTitle: labelColumn.label };
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-body">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
          {item.detail && <span className="text-muted">{item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-md"
      style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
    >
      <p className="font-semibold">{tip.title}</p>
      {tip.lines.map((line) => (
        <p key={line.label} className="flex items-center gap-1.5 text-body">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: line.color }}
          />
          {line.label}: {line.value}
        </p>
      ))}
    </div>
  );
}

/** Value gridlines and labels, plus the category labels under the plot. */
function Axes({ max, type, labels }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const band = PLOT_W / labels.length;
  const every = Math.ceil(labels.length / MAX_X_LABELS);
  return (
    <g fontSize="12" fill={AXIS_TEXT}>
      {ticks.map((tick) => {
        const y = M.top + PLOT_H - (tick / max) * PLOT_H;
        return (
          <g key={tick}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth="1"
            />
            <text x={M.left - 6} y={y + 4} textAnchor="end">
              {formatCell(tick, type)}
            </text>
          </g>
        );
      })}
      {labels.map((label, i) =>
        i % every === 0 ? (
          <text
            key={i}
            x={M.left + band * (i + 0.5)}
            y={H - M.bottom + 16}
            textAnchor="middle"
          >
            {shorten(label, every > 1 ? 10 : 14)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** A column with a rounded top (4px) sitting on the baseline. */
function columnPath(x, width, top, bottom) {
  const r = Math.min(4, width / 2, bottom - top);
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
}

function BarChart({ data, setTip }) {
  const { labels, series, type } = data;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values ?? 0)));
  const band = PLOT_W / labels.length;
  const gap = 2;
  const barW = Math.max(
    2,
    Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length),
  );
  const groupW = barW * series.length + gap * (series.length - 1);
  const baseline = M.top + PLOT_H;
  return (
    <>
      <Axes max={max} type={type} labels={labels} />
      {labels.map((label, i) =>
        series.map((s, k) => {
          const value = s.values[i];
          if (value == null || value <= 0) return null;
          const x = M.left + band * i + (band - groupW) / 2 + k * (barW + gap);
          const top = baseline - (value / max) * PLOT_H;
          const text = `${label}, ${s.label}: ${formatCell(value, type)}`;
          const show = () =>
            setTip({
              x: x + barW / 2,
              y: top - 4,
              title: label,
              lines: [
                {
                  label: s.label,
                  value: formatCell(value, type),
                  color: seriesColor(s, k),
                },
              ],
            });
          return (
            <path
              key={`${i}-${k}`}
              d={columnPath(x, barW, top, baseline)}
              style={{ fill: seriesColor(s, k) }}
              tabIndex={0}
              aria-label={text}
              onMouseEnter={show}
              onFocus={show}
              onMouseLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
              className="outline-none focus:opacity-80"
            />
          );
        }),
      )}
      <line
        x1={M.left}
        x2={W - M.right}
        y1={baseline}
        y2={baseline}
        stroke={AXIS_TEXT}
        strokeWidth="1"
      />
    </>
  );
}

function LineChart({ data, setTip }) {
  const { labels, series, type } = data;
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values ?? 0)));
  const band = PLOT_W / labels.length;
  const x = (i) => M.left + band * (i + 0.5);
  const y = (v) => M.top + PLOT_H - (v / max) * PLOT_H;
  return (
    <>
      <Axes max={max} type={type} labels={labels} />
      {hover !== null && (
        <line
          x1={x(hover)}
          x2={x(hover)}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke={AXIS_TEXT}
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      {series.map((s, k) => {
        const points = s.values
          .map((v, i) => (v == null ? null : [x(i), y(v)]))
          .filter(Boolean);
        return (
          <g key={s.label}>
            <path
              d={points
                .map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`)
                .join(" ")}
              fill="none"
              style={{ stroke: seriesColor(s, k) }}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {points.length <= 31 &&
              points.map(([px, py]) => (
                <circle
                  key={px}
                  cx={px}
                  cy={py}
                  r="4"
                  style={{ fill: seriesColor(s, k) }}
                  stroke="#fff"
                  strokeWidth="2"
                />
              ))}
          </g>
        );
      })}
      {labels.map((label, i) => (
        <rect
          key={i}
          x={M.left + band * i}
          y={M.top}
          width={band}
          height={PLOT_H}
          fill="transparent"
          onMouseEnter={() => {
            setHover(i);
            setTip({
              x: x(i),
              y: M.top + 4,
              title: label,
              lines: series.map((s, k) => ({
                label: s.label,
                value: formatCell(s.values[i], type) || "–",
                color: seriesColor(s, k),
              })),
            });
          }}
          onMouseLeave={() => {
            setHover(null);
            setTip(null);
          }}
        />
      ))}
    </>
  );
}

/** Up to 8 slices in data order; past that the smallest fold into "Other". */
function pieSlices(data) {
  const [first] = data.series;
  const slices = data.labels
    .map((label, i) => ({ label, value: first.values[i] ?? 0 }))
    .filter((slice) => slice.value > 0);
  if (slices.length <= SERIES.length)
    return slices.map((s, i) => ({ ...s, color: SERIES[i] }));
  const kept = [...slices]
    .sort((a, b) => b.value - a.value)
    .slice(0, SERIES.length - 1);
  const rest = slices.filter((s) => !kept.includes(s));
  return [
    ...slices
      .filter((s) => kept.includes(s))
      .map((s, i) => ({ ...s, color: SERIES[i] })),
    {
      label: "Other",
      value: rest.reduce((sum, s) => sum + s.value, 0),
      color: OTHER,
    },
  ];
}

function arc(cx, cy, r, inner, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const p = (radius, angle) => [
    cx + radius * Math.sin(angle),
    cy - radius * Math.cos(angle),
  ];
  const [x1, y1] = p(r, start);
  const [x2, y2] = p(r, end);
  const [x3, y3] = p(inner, end);
  const [x4, y4] = p(inner, start);
  return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
}

function PieChart({ slices, type, setTip }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const cx = W / 2;
  const cy = H / 2;
  const r = H / 2 - 12;
  let angle = 0;
  return slices.map((slice) => {
    const start = angle;
    const sweep = (slice.value / total) * Math.PI * 2;
    angle += sweep;
    // A lone slice is a full ring: stop just short of 2π so the arc draws.
    const end = start + Math.min(sweep, Math.PI * 2 - 0.0001);
    const mid = (start + end) / 2;
    const share = `${formatCell((slice.value / total) * 100, "percent")}`;
    const show = () =>
      setTip({
        x: cx + r * 0.75 * Math.sin(mid),
        y: cy - r * 0.75 * Math.cos(mid),
        title: slice.label,
        lines: [
          {
            label: share,
            value: formatCell(slice.value, type),
            color: slice.color,
          },
        ],
      });
    return (
      <path
        key={slice.label}
        d={arc(cx, cy, r, r * 0.58, start, end)}
        fill={slice.color}
        stroke="#fff"
        strokeWidth="2"
        tabIndex={0}
        aria-label={`${slice.label}: ${formatCell(slice.value, type)} (${share})`}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setTip(null)}
        onBlur={() => setTip(null)}
        className="outline-none focus:opacity-80"
      />
    );
  });
}

const KIND_LABELS = { bar: "Bar chart", line: "Line chart", pie: "Pie chart" };

/**
 * The chart a result asks for (bar, line or pie) above its table: first column = labels, the
 * numeric columns = series. Returns null when there is nothing to draw.
 */
export default function ReportChart({ result }) {
  const [tip, setTip] = useState(null);
  const kind = KIND_LABELS[result.chart] ? result.chart : null;
  const data = kind ? chartData(result) : null;
  if (!data) return null;

  const slices = kind === "pie" ? pieSlices(data) : null;
  if (slices && !slices.length) return null;
  const legend =
    kind === "pie"
      ? slices.map((s) => ({
          label: s.label,
          color: s.color,
          detail: formatCell(s.value, data.type),
        }))
      : data.series.length > 1
        ? data.series.map((s, k) => ({
            label: s.label,
            color: seriesColor(s, k),
          }))
        : null;
  const what =
    kind === "pie"
      ? data.series[0].label
      : data.series.map((s) => s.label).join(", ");

  return (
    <figure className="space-y-2">
      {legend && <Legend items={legend} />}
      <div className="relative">
        <svg
          role="img"
          aria-label={`${KIND_LABELS[kind]}: ${what} by ${data.labelTitle}. The table below has every value.`}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
        >
          {kind === "bar" && <BarChart data={data} setTip={setTip} />}
          {kind === "line" && <LineChart data={data} setTip={setTip} />}
          {kind === "pie" && (
            <PieChart slices={slices} type={data.type} setTip={setTip} />
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </figure>
  );
}
