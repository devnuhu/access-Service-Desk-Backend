import { Swatch } from "./ChartLegend.jsx";

/**
 * The hover card: a title and one line per value, placed at (x, y) in pixels inside a relative
 * parent, above the point and kept inside the chart.
 */
export default function ChartTooltip({ tip, width }) {
  if (!tip) return null;
  const left = Math.max(80, Math.min(width - 80, tip.x));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink shadow-lg"
      style={{ left, top: tip.y }}
    >
      <p className="font-semibold whitespace-nowrap">{tip.title}</p>
      {tip.lines.map((line) => (
        <p
          key={line.label}
          className="flex items-center gap-1.5 whitespace-nowrap text-body"
        >
          {line.color && (
            <Swatch
              color={line.color}
              hatched={line.hatched}
              line={line.line}
            />
          )}
          {line.label}:{" "}
          <span className="font-semibold text-ink tabular-nums">
            {line.value}
          </span>
        </p>
      ))}
      {tip.note && (
        <p className="mt-1 max-w-56 text-[11px] whitespace-normal text-muted">
          {tip.note}
        </p>
      )}
    </div>
  );
}
