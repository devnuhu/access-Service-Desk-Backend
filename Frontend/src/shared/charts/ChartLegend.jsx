import { HATCH } from "./palette.js";

/** A swatch: the series colour, striped for a hatched series. */
export function Swatch({ color, hatched = false, line = false }) {
  if (line)
    return (
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-3.5 rounded-full"
        style={{ background: color }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{
        backgroundColor: color,
        backgroundImage: hatched ? HATCH : undefined,
      }}
    />
  );
}

/**
 * The series of a chart. With `onToggle` each item is a button that shows or hides its series
 * (aria-pressed); the last visible one cannot be hidden.
 */
export default function ChartLegend({ items, hidden = [], onToggle }) {
  const visible = items.filter((item) => !hidden.includes(item.key)).length;
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-1 text-xs text-body">
      {items.map((item) => {
        const off = hidden.includes(item.key);
        const content = (
          <>
            <Swatch
              color={item.color}
              hatched={item.hatched}
              line={item.line}
            />
            <span className={off ? "text-muted line-through" : ""}>
              {item.label}
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                disabled={!off && visible === 1}
                onClick={() => onToggle(item.key)}
                title={off ? `Show ${item.label}` : `Hide ${item.label}`}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-page disabled:cursor-default disabled:hover:bg-transparent"
              >
                {content}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5">
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
