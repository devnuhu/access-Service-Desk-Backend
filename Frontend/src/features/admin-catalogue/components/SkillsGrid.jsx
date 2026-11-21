import { useRef, useState } from "react";
import { Chip } from "@/shared/ui";

const KEY_STEPS = {
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
};

const personName = (member) => member.fullName || member.userName;

/**
 * The skills matrix grid: rows are members, columns the unit's categories, cells checkboxes.
 * Keyboard: one cell is in the Tab order; arrow keys move between cells, Home/End to the ends of
 * the row, Space toggles. A cell that cannot be newly ticked (switched-off category, blocked
 * person) stays focusable but does nothing (aria-disabled), so arrow keys never skip cells.
 *
 * @param {Object} props
 * @param {any[]} props.categories  SkillCategoryDto[]
 * @param {any[]} props.members  SkillMemberDto[]
 * @param {(member: any) => Set<string>} props.valueFor  the person's set, with local edits
 * @param {(member: any, categoryId: string) => boolean} props.canTick
 * @param {(categoryId: string) => number} props.countFor  eligible case workers, with local edits
 * @param {(member: any, next: Set<string>) => void} props.onChange
 * @param {Set<string>} props.changed  userIds with unsaved edits
 * @param {string | null} props.failedId  userId whose save failed
 * @param {boolean} [props.readOnly]  look only (an HOD): cells disabled, no All / None
 * @param {(member: any) => import("react").ReactNode} [props.noteFor]  extra chips for a person
 * @param {string} [props.changedLabel]  the chip on a changed row ("Changed", or "Saving…")
 */
export default function SkillsGrid({
  categories,
  members,
  valueFor,
  canTick,
  countFor,
  onChange,
  changed,
  failedId,
  readOnly = false,
  noteFor,
  changedLabel = "Changed",
}) {
  const [active, setActive] = useState({ row: 0, col: 0 });
  const cells = useRef(new Map());

  const focusCell = (row, col) => {
    const r = Math.min(Math.max(row, 0), members.length - 1);
    const c = Math.min(Math.max(col, 0), categories.length - 1);
    setActive({ row: r, col: c });
    cells.current.get(`${r}:${c}`)?.focus();
  };

  const onKeyDown = (event, row, col) => {
    const step = KEY_STEPS[event.key];
    if (step) {
      event.preventDefault();
      focusCell(row + step[0], col + step[1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusCell(row, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusCell(row, categories.length - 1);
    }
  };

  const toggle = (member, categoryId) => {
    if (member.isHead) return;
    const next = new Set(valueFor(member));
    if (next.has(categoryId)) next.delete(categoryId);
    else if (canTick(member, categoryId)) next.add(categoryId);
    else return;
    onChange(member, next);
  };

  const setAll = (member, on) => {
    const current = valueFor(member);
    const next = on
      ? new Set(
          categories
            .filter((c) => current.has(c.id) || canTick(member, c.id))
            .map((c) => c.id),
        )
      : new Set();
    onChange(member, next);
  };

  return (
    <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto">
      <table
        className="border-separate border-spacing-0 text-sm"
        aria-label="Skills matrix"
        aria-describedby="skills-keyboard-hint"
      >
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 min-w-64 border-r border-b border-line bg-page px-4 py-2 text-left text-xs font-semibold text-muted uppercase"
            >
              Case worker
            </th>
            {categories.map((category) => (
              <th
                key={category.id}
                scope="col"
                title={
                  category.isActive
                    ? category.name
                    : `${category.name} (switched off)`
                }
                className={`sticky top-0 z-20 w-28 min-w-28 border-b border-line bg-page px-2 py-2 text-left align-bottom text-xs font-semibold ${category.isActive ? "text-ink" : "text-muted"}`}
              >
                <span className="line-clamp-3 leading-tight break-words">
                  {category.name}
                </span>
                {!category.isActive && (
                  <span className="mt-0.5 block font-normal">Off</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member, row) => {
            const value = valueFor(member);
            const isChanged = changed.has(member.userId);
            const isFailed = failedId === member.userId;
            const head = Boolean(member.isHead);
            const rowTone = isFailed
              ? "bg-danger-light"
              : isChanged
                ? "bg-brand-orange-light"
                : head
                  ? "bg-page"
                  : "bg-white";
            return (
              <tr
                key={member.userId}
                data-testid={`row-${member.userId}`}
                data-head={head ? "true" : undefined}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 border-r border-b border-line px-4 py-2 text-left font-normal ${rowTone} ${isChanged ? "shadow-[inset_3px_0_0] shadow-brand-orange" : ""}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span
                        className={`flex items-center gap-1.5 truncate font-semibold ${head ? "text-muted" : "text-ink"}`}
                      >
                        {personName(member)}
                        {head && <Chip tone="navy">Head</Chip>}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {member.userName}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {head && (
                          <span
                            data-testid="head-note"
                            className="text-xs text-muted italic"
                          >
                            Heads are not assigned automatically
                          </span>
                        )}
                        {!member.accountActive && (
                          <Chip tone="red">Blocked</Chip>
                        )}
                        {noteFor?.(member)}
                        {isChanged && (
                          <Chip tone="orange" data-testid="row-changed">
                            {isFailed ? "Not saved" : changedLabel}
                          </Chip>
                        )}
                      </span>
                    </span>
                    {!readOnly && !head && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => setAll(member, true)}
                          className="rounded px-1.5 py-0.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy-light"
                          aria-label={`Tick every category for ${personName(member)}`}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setAll(member, false)}
                          className="rounded px-1.5 py-0.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy-light"
                          aria-label={`Clear every category for ${personName(member)}`}
                        >
                          None
                        </button>
                      </span>
                    )}
                  </span>
                </th>
                {categories.map((category, col) => {
                  const checked = value.has(category.id);
                  const locked = !checked && !canTick(member, category.id);
                  const isActiveCell = active.row === row && active.col === col;
                  return (
                    <td
                      key={category.id}
                      className={`border-b border-line px-2 py-2 text-center ${rowTone} ${category.isActive && !head ? "" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        ref={(element) => {
                          const key = `${row}:${col}`;
                          if (element) cells.current.set(key, element);
                          else cells.current.delete(key);
                        }}
                        tabIndex={isActiveCell ? 0 : -1}
                        checked={checked}
                        disabled={readOnly || head}
                        aria-disabled={locked ? "true" : undefined}
                        aria-label={`${category.name} for ${personName(member)}`}
                        title={
                          head
                            ? "Heads are not assigned automatically"
                            : locked
                              ? category.isActive
                                ? `${personName(member)} is blocked`
                                : `${category.name} is switched off`
                              : undefined
                        }
                        onChange={() => toggle(member, category.id)}
                        onFocus={() => setActive({ row, col })}
                        onKeyDown={(event) => onKeyDown(event, row, col)}
                        className={`h-4 w-4 accent-brand-navy [scroll-margin:5rem_1rem_3rem_17rem] ${readOnly ? "cursor-default" : locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-30 border-t border-r border-line bg-page px-4 py-2 text-left text-xs font-semibold text-muted uppercase"
            >
              Case workers
            </th>
            {categories.map((category) => {
              const count = countFor(category.id);
              const short = category.isActive && count < 2;
              return (
                <td
                  key={category.id}
                  data-testid={`footer-count-${category.id}`}
                  title={
                    short ? "Fewer than two case workers handle it" : undefined
                  }
                  className={`sticky bottom-0 z-20 border-t border-line px-2 py-2 text-center font-semibold tabular-nums ${short ? "bg-brand-orange-light text-brand-orange-ink" : "bg-page text-body"}`}
                >
                  {count}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
