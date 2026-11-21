/**
 * The line above a unit page's title: "FUND UNIT · Contribution Processing". The unit in the
 * eyebrow's capitals, the department small and muted. Without a department, just the unit.
 */
export default function UnitEyebrow({ unitName, departmentName }) {
  return (
    <span data-testid="unit-eyebrow">
      {unitName}
      {departmentName && (
        <span className="font-normal tracking-normal text-muted normal-case">
          {" · "}
          {departmentName}
        </span>
      )}
    </span>
  );
}
