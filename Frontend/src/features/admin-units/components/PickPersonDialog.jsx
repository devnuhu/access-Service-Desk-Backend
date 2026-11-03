import { useState } from "react";
import { AddFromDirectoryDialog, searchPeople } from "@/features/admin-people";
import { Button, Dialog, PersonPicker } from "@/shared/ui";

/**
 * The person picker (People list search), with "Not listed? Add from directory", which opens FE-0's
 * directory dialog and then selects the new person. Picking someone calls `onPick(person)`.
 * `children` adds fields under the picker (staff number for Add member); with `confirmLabel` the
 * pick is only a selection until the confirm button is pressed.
 */
export default function PickPersonDialog({
  open,
  onClose,
  title,
  description,
  onPick,
  confirmLabel,
  busy = false,
  exclude,
  children,
}) {
  const [selected, setSelected] = useState(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);

  const close = () => {
    setSelected(null);
    onClose();
  };

  const choose = (person) => {
    if (confirmLabel) setSelected(person);
    else onPick(person);
  };

  return (
    <>
      <Dialog
        open={open && !directoryOpen}
        onClose={close}
        title={title}
        description={description}
        footer={
          confirmLabel ? (
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={() => selected && onPick(selected)}
                disabled={!selected}
                busy={busy}
              >
                {confirmLabel}
              </Button>
            </>
          ) : null
        }
      >
        <div className="space-y-4">
          <PersonPicker
            search={searchPeople}
            onSelect={choose}
            selectedId={selected?.id}
            exclude={exclude}
            queryKey={["admin-people", "picker"]}
            footer={
              <button
                type="button"
                onClick={() => setDirectoryOpen(true)}
                className="font-semibold text-brand-navy hover:underline"
              >
                Not listed? Add from directory
              </button>
            }
          />
          {selected && (
            <p className="rounded-[6px] bg-brand-navy-light px-3 py-2 text-sm text-ink">
              Selected:{" "}
              <strong>{selected.fullName || selected.userName}</strong>
            </p>
          )}
          {children}
        </div>
      </Dialog>
      <AddFromDirectoryDialog
        open={open && directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        onAdded={(userId, added) => {
          setDirectoryOpen(false);
          choose({
            id: userId,
            fullName: added?.fullName ?? null,
            userName: added?.userName ?? null,
            department: added?.department ?? null,
          });
        }}
      />
    </>
  );
}
