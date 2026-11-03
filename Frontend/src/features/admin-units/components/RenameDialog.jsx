import { useState } from "react";
import { fieldError } from "@/shared/lib/http";
import { Button, Dialog, useToast } from "@/shared/ui";

/** Rename a department or unit. `onSave(name)` returns the mutation promise ({ message }). */
export default function RenameDialog({
  open,
  onClose,
  title,
  initialName,
  onSave,
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    try {
      const result = await onSave(name.trim());
      toast.success(result.message);
      onClose();
    } catch (caught) {
      setError(fieldError(caught, "name") ?? null);
      toast.error(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-form" busy={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="rename-form" onSubmit={save} noValidate>
        <label
          htmlFor="rename-name"
          className="block text-sm font-semibold text-ink"
        >
          Name
        </label>
        <input
          id="rename-name"
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "rename-error" : undefined}
          className={`mt-1 h-10 w-full rounded-[6px] border px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
        />
        {error && (
          <p id="rename-error" className="mt-1 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
