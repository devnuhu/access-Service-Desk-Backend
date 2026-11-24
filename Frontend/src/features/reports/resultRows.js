import { cellValue, formatCell, NUMERIC_TYPES } from "./cells.js";

/**
 * Report results are in the browser whole (up to the server's cap), so the table searches, sorts
 * and pages them here. Export is separate: it always asks the server for the complete result.
 */

/** The rows (with their original index) whose cells contain `text`, in any column, any case. */
export function matchingRows(data, text) {
  const rows = data.rows.map((row, index) => ({ row, index }));
  const wanted = text.trim().toLowerCase();
  if (!wanted) return rows;
  return rows.filter(({ row }) =>
    data.columns.some((column, i) => {
      const value = cellValue(row, column, i);
      if (value === null || value === undefined) return false;
      return (
        formatCell(value, column.type).toLowerCase().includes(wanted) ||
        String(value).toLowerCase().includes(wanted)
      );
    }),
  );
}

/**
 * All the given rows ordered by column `index` ("asc" or "desc"): numbers as numbers, the rest as
 * text (dates are yyyy-MM-dd, so text order is date order). Empty cells always last; ties keep
 * the server's order.
 */
export function sortRows(data, rows, index, direction) {
  if (index == null) return rows;
  const column = data.columns[index];
  const isNumber = NUMERIC_TYPES.includes(column.type);
  const sign = direction === "desc" ? -1 : 1;
  const empty = (v) => v === null || v === undefined || v === "";
  return [...rows].sort((a, b) => {
    const x = cellValue(a.row, column, index);
    const y = cellValue(b.row, column, index);
    if (empty(x) || empty(y))
      return empty(x) === empty(y) ? a.index - b.index : empty(x) ? 1 : -1;
    const order = isNumber
      ? Number(x) - Number(y)
      : String(x).localeCompare(String(y), undefined, { numeric: true });
    return order === 0 ? a.index - b.index : sign * order;
  });
}
