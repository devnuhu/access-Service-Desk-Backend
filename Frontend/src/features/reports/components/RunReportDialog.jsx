import { useEffect, useId, useState } from "react";
import { Download, Save } from "lucide-react";
import { Button, Dialog, Spinner, Switch, useToast } from "@/shared/ui";
import { cellValue, formatCell, formatRunAt, NUMERIC_TYPES } from "../cells.js";
import {
  downloadReport,
  useRefreshSavedReports,
  useRunReport,
  useUpdateSavedReport,
} from "../hooks/useReports.js";
import { isGone, savedReportBody } from "../savedReport.js";
import ReportChart from "./ReportChart.jsx";

const CUSTOM = "custom";
const numeric = (type) => NUMERIC_TYPES.includes(type);

/** The range a definition starts with: its preset, its own dates, or none ("" = as saved). */
function initialRange(definition) {
  if (definition.preset) return { choice: definition.preset, from: "", to: "" };
  if (definition.from || definition.to)
    return {
      choice: CUSTOM,
      from: definition.from ?? "",
      to: definition.to ?? "",
    };
  return { choice: "", from: "", to: "" };
}

/**
 * Notes under the table: the catalogue's description of each measure that ignores the date range
 * (the catalogue says so: "Ignores the period"), and, grouped by person, that people with no
 * tickets are not listed.
 */
function ResultNotes({ data, measures, definition }) {
  const byKey = new Map(measures.map((m) => [m.key, m]));
  const timeless = data.columns
    .map((column) => byKey.get(column.key))
    .filter((m) => m && /ignores the period/i.test(m.description));
  const byPerson = definition?.groupBy === "assignee";
  if (!timeless.length && !byPerson) return null;
  return (
    <ul
      data-testid="report-notes"
      className="mt-3 space-y-1 text-xs text-muted"
    >
      {timeless.map((m) => (
        <li key={m.key}>
          <strong className="font-semibold text-body">{m.label}:</strong>{" "}
          {m.description}
        </li>
      ))}
      {byPerson && (
        <li>
          A person with no tickets in this report does not appear as a zero
          line.
        </li>
      )}
    </ul>
  );
}

/** Results grouped by these can be drawn as bars of one numeric column ("Show as chart"). */
const CHARTABLE_GROUPS = ["assignee", "unit"];

/** The numeric columns a table result can draw, Resolved and Within time first when present. */
function chartColumns(data) {
  const rank = (column) =>
    /^resolved/i.test(column.label) ? 0 : /within/i.test(column.label) ? 1 : 2;
  return data.columns
    .map((column, index) => ({ column, index }))
    .slice(1)
    .filter(({ column }) => NUMERIC_TYPES.includes(column.type))
    .sort((a, b) => rank(a.column) - rank(b.column));
}

/** A table result as bars of one column: the label column and the chosen one. */
function asBars(data, index) {
  return {
    ...data,
    chart: "bar",
    columns: [data.columns[0], data.columns[index]],
    rows: data.rows.map((row) => [row[0], row[index]]),
  };
}

function ResultTable({ data, measures = [] }) {
  const help = new Map(measures.map((m) => [m.key, m.description]));
  const cellClass = (column) =>
    `px-3 py-2 ${numeric(column.type) ? "text-right tabular-nums" : ""}`;
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-page text-xs font-semibold text-muted">
          <tr>
            {data.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                title={help.get(column.key)}
                className={`px-3 py-2 whitespace-nowrap ${numeric(column.type) ? "text-right" : ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {data.columns.map((column, i) => (
                <td key={column.key} className={cellClass(column)}>
                  {formatCell(cellValue(row, column, i), column.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {data.totals && (
          <tfoot className="border-t border-line bg-page font-semibold">
            <tr>
              {data.columns.map((column, i) => {
                const value = cellValue(data.totals, column, i);
                return (
                  <td key={column.key} className={cellClass(column)}>
                    {i === 0 && (value === null || value === undefined)
                      ? "Total"
                      : formatCell(value, column.type)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Runs a report with the viewer's own scope. A ready-made one sends its catalogue definition as it
 * is; a saved one runs through /saved/{id}/run. Changing the dates runs the definition again with
 * only preset/from/to replaced. For a saved report that change is temporary until its owner
 * presses "Save changes". The downloads and "Save as my report" use what is on screen.
 *
 * @param {{ report: { title: string, description?: string, definition: object, saved?: object },
 *   presets: { key: string, label: string }[], onSave: (definition: object) => void, onClose: () => void }} props
 */
export default function RunReportDialog({
  report,
  presets,
  measures = [],
  onSave,
  onClose,
}) {
  const toast = useToast();
  const refreshSaved = useRefreshSavedReports();
  const updateSaved = useUpdateSavedReport();
  const ids = { range: useId(), from: useId(), to: useId() };
  const [range, setRange] = useState(() => initialRange(report.definition));
  // The definition on screen; null until the dates are changed (then the original runs as it is).
  const [changed, setChanged] = useState(null);
  const [draft, setDraft] = useState({ from: range.from, to: range.to });
  const [rangeError, setRangeError] = useState("");
  const [downloading, setDownloading] = useState(null);
  const [tableOnly, setTableOnly] = useState(false);
  // A table grouped by person or unit: "Show as chart" draws one numeric column as bars.
  const [asChart, setAsChart] = useState(false);
  const [chartColumn, setChartColumn] = useState(null);

  const saved = report.saved;
  const definition = changed ?? report.definition;
  const source = {
    savedReportId: changed ? undefined : saved?.id,
    definition,
    title: report.title,
  };
  const result = useRunReport(source);
  const data = result.data;

  // The saved report was deleted or is no longer shared: the list catches up.
  const gone = Boolean(saved) && isGone(result.error);
  useEffect(() => {
    if (gone) refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per 404
  }, [gone]);

  const apply = (next) => {
    setRange(next);
    setChanged({
      ...report.definition,
      preset: next.choice === CUSTOM ? null : next.choice || null,
      from: next.choice === CUSTOM ? next.from || null : null,
      to: next.choice === CUSTOM ? next.to || null : null,
    });
  };

  const choose = (choice) => {
    setRangeError("");
    if (choice === CUSTOM) {
      setRange((current) => ({ ...current, choice }));
      return;
    }
    apply({ choice, from: "", to: "" });
  };

  const applyCustom = () => {
    if (!draft.from || !draft.to) {
      setRangeError("Choose both dates.");
      return;
    }
    if (draft.from > draft.to) {
      setRangeError("The start date must be on or before the end date.");
      return;
    }
    setRangeError("");
    apply({ choice: CUSTOM, ...draft });
  };

  const download = async (format) => {
    setDownloading(format);
    try {
      const name = await downloadReport(source, format);
      toast.success(`${name} downloaded.`);
    } catch (error) {
      if (saved && isGone(error)) refreshSaved();
      toast.error(error.message, { title: `${report.title} not downloaded` });
    } finally {
      setDownloading(null);
    }
  };

  const saveChanges = async () => {
    try {
      const updated = await updateSaved.mutateAsync({
        id: saved.id,
        body: savedReportBody({
          ...saved,
          description: saved.description ?? "",
          definition: changed,
        }),
      });
      toast.success("The new dates are saved with the report.", {
        title: `${updated.name} saved`,
      });
    } catch (error) {
      if (isGone(error)) refreshSaved();
      toast.error(error.message, { title: `${saved.name} not saved` });
    }
  };

  const hasPreset = presets.some((p) => p.key === range.choice);
  const showChart = data && data.chart !== "table" && data.rows.length > 0;
  const barColumns =
    data &&
    !showChart &&
    data.rows.length > 0 &&
    CHARTABLE_GROUPS.includes(definition?.groupBy)
      ? chartColumns(data)
      : [];
  const barIndex =
    barColumns.find(({ index }) => index === chartColumn)?.index ??
    barColumns[0]?.index;

  return (
    <Dialog
      open
      size="wide"
      onClose={onClose}
      title={report.title}
      description={
        report.description
          ? `${report.description} Shows only what you are allowed to see.`
          : "Shows only what you are allowed to see."
      }
      footer={
        <>
          <Button
            variant="secondary"
            busy={downloading === "xlsx"}
            busyText="Building Excel…"
            onClick={() => download("xlsx")}
          >
            <Download aria-hidden="true" size={16} />
            Download Excel
          </Button>
          <Button
            variant="secondary"
            busy={downloading === "csv"}
            busyText="Building CSV…"
            onClick={() => download("csv")}
          >
            <Download aria-hidden="true" size={16} />
            Download CSV
          </Button>
          {saved?.isMine && changed && (
            <Button
              variant="secondary"
              busy={updateSaved.isPending}
              onClick={saveChanges}
            >
              <Save aria-hidden="true" size={16} />
              Save changes
            </Button>
          )}
          <Button onClick={() => onSave(definition)}>
            <Save aria-hidden="true" size={16} />
            Save as my report
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor={ids.range}
              className="block text-sm font-semibold text-ink"
            >
              Dates (Lagos time)
            </label>
            <select
              id={ids.range}
              value={range.choice}
              onChange={(event) => choose(event.target.value)}
              className="mt-1 h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
            >
              {(range.choice === "" ||
                (!hasPreset && range.choice !== CUSTOM)) && (
                <option value={range.choice}>
                  {range.choice ? range.choice : "As set in the report"}
                </option>
              )}
              {presets.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom</option>
            </select>
          </div>
          {range.choice === CUSTOM && (
            <>
              <div>
                <label
                  htmlFor={ids.from}
                  className="block text-sm font-semibold text-ink"
                >
                  From
                </label>
                <input
                  id={ids.from}
                  type="date"
                  value={draft.from}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, from: event.target.value }))
                  }
                  className="mt-1 h-10 rounded-lg border border-line px-3 text-sm text-ink"
                />
              </div>
              <div>
                <label
                  htmlFor={ids.to}
                  className="block text-sm font-semibold text-ink"
                >
                  To
                </label>
                <input
                  id={ids.to}
                  type="date"
                  value={draft.to}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, to: event.target.value }))
                  }
                  className="mt-1 h-10 rounded-lg border border-line px-3 text-sm text-ink"
                />
              </div>
              <Button variant="secondary" onClick={applyCustom}>
                Apply dates
              </Button>
            </>
          )}
          {barColumns.length > 0 && (
            <div className="ml-auto flex flex-wrap items-end gap-3">
              {asChart && (
                <div>
                  <label
                    htmlFor={`${ids.range}-measure`}
                    className="block text-sm font-semibold text-ink"
                  >
                    Chart
                  </label>
                  <select
                    id={`${ids.range}-measure`}
                    value={barIndex}
                    onChange={(event) =>
                      setChartColumn(Number(event.target.value))
                    }
                    className="mt-1 h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                  >
                    {barColumns.map(({ column, index }) => (
                      <option key={column.key} value={index}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Switch
                checked={asChart}
                onChange={setAsChart}
                label="Show as chart"
              />
            </div>
          )}
          {showChart && (
            <div className="ml-auto">
              <Switch
                checked={tableOnly}
                onChange={setTableOnly}
                label="Table only"
              />
            </div>
          )}
        </div>
        {rangeError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {rangeError}
          </p>
        )}
        {saved?.isMine && changed && (
          <p className="text-xs text-muted">
            These dates are for now only. Press Save changes to keep them with
            the report.
          </p>
        )}

        {result.isLoading ? (
          <div className="py-10 text-center text-muted">
            <Spinner label="Running the report…" />
          </div>
        ) : result.isError ? (
          <p role="alert" className="py-6 text-sm text-danger">
            {result.error.message}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted">
              {data.from || data.to
                ? `${formatCell(data.from, "date") || "…"} to ${formatCell(data.to, "date") || "…"} · `
                : ""}
              {formatRunAt(data.generatedAt)}
            </p>
            {data.truncated && (
              <p className="rounded-lg bg-brand-orange-light px-3 py-2 text-xs font-medium text-brand-orange-ink">
                Showing the first rows only. Download the file for the full
                list.
              </p>
            )}
            {!data.rows.length ? (
              <p className="py-6 text-center text-sm text-muted">
                Nothing found for this period.
              </p>
            ) : (
              <>
                {showChart && !tableOnly && <ReportChart result={data} />}
                {asChart && barIndex != null && (
                  <ReportChart result={asBars(data, barIndex)} />
                )}
                <ResultTable data={data} measures={measures} />
                <ResultNotes
                  data={data}
                  measures={measures}
                  definition={definition}
                />
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
