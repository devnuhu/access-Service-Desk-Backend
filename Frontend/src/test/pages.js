/**
 * What GET /api/pool answers for a list of pool rows: the unit and search filters, one page, the
 * total and the per-unit counts (which ignore the unit filter, like the server's).
 */
export function poolPage(
  rows,
  { search, unitId, page = 1, pageSize = 10 } = {},
) {
  const term = (search ?? "").toLowerCase();
  const matching = rows
    .map((row) => ({ subject: `Subject of ${row.reference}`, ...row }))
    .filter(
      (row) =>
        !term ||
        [row.reference, row.subject, row.categoryName].some((v) =>
          v.toLowerCase().includes(term),
        ),
    );
  const units = [];
  for (const row of matching) {
    const unit = units.find((u) => u.id === row.unitId);
    if (unit) unit.count += 1;
    else units.push({ id: row.unitId, name: row.unitName, count: 1 });
  }
  const inUnit = unitId
    ? matching.filter((row) => row.unitId === unitId)
    : matching;
  return {
    items: inUnit.slice((page - 1) * pageSize, page * pageSize),
    total: inUnit.length,
    page,
    pageSize,
    units,
  };
}
