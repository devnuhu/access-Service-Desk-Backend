import { useEffect, useId, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { fieldError } from "@/shared/lib/http";
import { Button, ConfirmDialog, Dialog, useToast } from "@/shared/ui";
import {
  useCreateView,
  useDeleteView,
  useSavedViews,
  useUpdateView,
} from "../hooks/useQueueTools.js";

export const MAX_VIEWS = 30;

/** Name a new view (the current filters), or rename one (`view`). 409 shows on the name. */
function ViewNameDialog({ view, filterJson, onClose, onSaved }) {
  const create = useCreateView();
  const update = useUpdateView();
  const [name, setName] = useState(view?.name ?? "");
  const [errors, setErrors] = useState({});
  const inputRef = useRef(null);
  const busy = create.isPending || update.isPending;

  const save = async (event) => {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2 || value.length > 60) {
      setErrors({ name: "Use 2 to 60 characters." });
      return;
    }
    try {
      const saved = view
        ? await update.mutateAsync({ viewId: view.id, name: value })
        : await create.mutateAsync({ name: value, filterJson });
      onSaved(saved);
    } catch (error) {
      const nameError =
        fieldError(error, "name") ??
        (error.status === 409 ? error.message : undefined);
      setErrors({
        name: nameError,
        form: nameError
          ? undefined
          : (fieldError(error, "filterJson") ?? error.message),
      });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={view ? `Rename ${view.name}` : "Save current filters as a view"}
      description={
        view ? undefined : "It keeps the tab and the filters you have now."
      }
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="view-name-form" busy={busy}>
            {view ? "Rename" : "Save view"}
          </Button>
        </>
      }
    >
      <form
        id="view-name-form"
        onSubmit={save}
        noValidate
        className="space-y-3"
      >
        {errors.form && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {errors.form}
          </p>
        )}
        <div>
          <label
            htmlFor="view-name"
            className="block text-sm font-semibold text-ink"
          >
            Name
          </label>
          <input
            ref={inputRef}
            id="view-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setErrors({});
            }}
            placeholder="For example, My overdue"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "view-name-error" : undefined}
            className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${errors.name ? "border-danger" : "border-line"}`}
          />
          {errors.name && (
            <p
              id="view-name-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.name}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink hover:bg-page";

/**
 * "Views" on the Work queue: the built-in views (defined in the app), then my saved views with a
 * star (favourite), rename and delete, then "Save current filters as view…". Applying one sets
 * the page's filters (`onApply(filterJson or filter object, name)`). `matches(filter)` says whether
 * a view's filters are the page's now: its name shows on the button.
 */
export default function ViewsMenu({ builtIns, filterJson, matches, onApply }) {
  const toast = useToast();
  const views = useSavedViews();
  const update = useUpdateView();
  const remove = useDeleteView();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(null);
  const [removing, setRemoving] = useState(null);
  const wrapperRef = useRef(null);
  const panelId = useId();
  const mine = views.data ?? [];
  const full = mine.length >= MAX_VIEWS;
  const active =
    builtIns.find((view) => matches(view.filter))?.name ??
    mine.find((view) => matches(view.filterJson))?.name ??
    null;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = (filter, name) => {
    onApply(filter, name);
    setOpen(false);
  };

  const star = async (view) => {
    try {
      await update.mutateAsync({
        viewId: view.id,
        isFavourite: !view.isFavourite,
      });
    } catch (error) {
      toast.error(error.message);
    }
  };

  const confirmRemove = async () => {
    try {
      const result = await remove.mutateAsync(removing.id);
      toast.success(result.message, { title: `${removing.name} deleted` });
    } catch (error) {
      toast.error(error.message, { title: `${removing.name} not deleted` });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:border-brand-navy"
      >
        <Bookmark aria-hidden="true" size={16} />
        <span>
          Views
          {active && <span className="font-normal text-body">: {active}</span>}
        </span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Views"
          className="absolute top-12 left-0 z-30 w-80 rounded-card border border-line bg-white p-2 shadow-xl"
        >
          <p className="px-2.5 pt-1 pb-1 text-[12px] font-semibold tracking-wider text-muted uppercase">
            Views
          </p>
          <ul aria-label="Built-in views">
            {builtIns.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  className={itemClass}
                  aria-current={active === view.name ? "true" : undefined}
                  onClick={() => apply(view.filter, view.name)}
                >
                  {view.name}
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-2 border-t border-line px-2.5 pt-3 pb-1 text-[12px] font-semibold tracking-wider text-muted uppercase">
            My views
          </p>
          {views.isLoading ? (
            <p className="px-2.5 py-2 text-sm text-muted">Loading…</p>
          ) : mine.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-muted">
              None yet. Set the filters, then save them as a view.
            </p>
          ) : (
            <ul aria-label="My views" className="max-h-64 overflow-y-auto">
              {mine.map((view) => (
                <li
                  key={view.id}
                  data-testid={`view-${view.name}`}
                  className="flex items-center gap-1"
                >
                  <button
                    type="button"
                    aria-pressed={view.isFavourite}
                    aria-label={`Favourite ${view.name}`}
                    onClick={() => star(view)}
                    className="rounded-md p-1.5 hover:bg-page"
                  >
                    <Star
                      aria-hidden="true"
                      size={15}
                      className={
                        view.isFavourite
                          ? "fill-brand-orange text-brand-orange"
                          : "text-muted"
                      }
                    />
                  </button>
                  <button
                    type="button"
                    className={`${itemClass} min-w-0 flex-1`}
                    aria-current={active === view.name ? "true" : undefined}
                    onClick={() => apply(view.filterJson, view.name)}
                  >
                    <span className="truncate">{view.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename ${view.name}`}
                    onClick={() => {
                      setOpen(false);
                      setNaming({ view });
                    }}
                    className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink"
                  >
                    <Pencil aria-hidden="true" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${view.name}`}
                    onClick={() => {
                      setOpen(false);
                      setRemoving(view);
                    }}
                    className="rounded-md p-1.5 text-muted hover:bg-danger-light hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 border-t border-line pt-2">
            <button
              type="button"
              className={`${itemClass} font-semibold text-brand-navy disabled:cursor-not-allowed disabled:opacity-50`}
              disabled={full}
              onClick={() => {
                setOpen(false);
                setNaming({});
              }}
            >
              <Plus aria-hidden="true" size={15} />
              Save current filters as view…
            </button>
            {full && (
              <p className="px-2.5 pb-1 text-xs text-muted">
                You have {MAX_VIEWS} views, the most allowed. Delete one to save
                another.
              </p>
            )}
          </div>
        </div>
      )}

      {naming && (
        <ViewNameDialog
          view={naming.view}
          filterJson={filterJson}
          onClose={() => setNaming(null)}
          onSaved={(saved) => {
            setNaming(null);
            toast.success(
              naming.view ? "The view is renamed." : "It is in Views.",
              { title: saved.name },
            );
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Delete ${removing?.name ?? ""}?`}
        message="The view goes from your list. No tickets change."
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
