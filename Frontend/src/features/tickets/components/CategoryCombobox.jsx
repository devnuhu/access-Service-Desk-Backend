import { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * Searchable category select (ARIA combobox with a list box): type to filter, arrow keys to move,
 * Enter to choose, Escape to close. Shows the chosen category's name when closed.
 */
export default function CategoryCombobox({
  id,
  categories,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const closeTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const chosen = categories.find((category) => category.id === value);
  const term = text.trim().toLowerCase();
  const matches = term
    ? categories.filter((category) =>
        category.name.toLowerCase().includes(term),
      )
    : categories;

  const choose = (category) => {
    onChange(category.id);
    setOpen(false);
    setText("");
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(Math.max(0, matches.indexOf(chosen)));
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        matches.length ? (index + step + matches.length) % matches.length : 0,
      );
    } else if (event.key === "Enter") {
      if (open && matches[active]) {
        event.preventDefault();
        choose(matches[active]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setText("");
      }
    }
  };

  const activeId = open && matches[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative mt-1">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        placeholder={chosen ? chosen.name : "Choose or type to search"}
        value={open ? text : (chosen?.name ?? "")}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          clearTimeout(closeTimer.current);
          setOpen(false);
        }}
        onClick={() => {
          clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Let a click on an option land first. Coming back before it fires cancels it, or it
          // would close the list just opened.
          closeTimer.current = setTimeout(() => {
            setOpen(false);
            setText("");
          }, 150);
        }}
        className={`h-10 w-full rounded-lg border bg-white pr-9 pl-3 text-sm text-ink placeholder:text-muted ${invalid ? "border-danger" : "border-line"} ${chosen && open ? "placeholder:text-ink" : ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show categories"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setOpen((value) => !value);
          inputRef.current?.focus();
        }}
        className="absolute top-1/2 right-1 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted"
      >
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Categories"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">
              No category matches “{text.trim()}”.
            </li>
          ) : (
            matches.map((category, index) => (
              <li
                key={category.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={category.id === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(category)}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-ink ${index === active ? "bg-brand-navy-light" : ""}`}
              >
                {category.name}
                {category.id === value && (
                  <Check
                    aria-hidden="true"
                    size={14}
                    className="text-brand-navy"
                  />
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
