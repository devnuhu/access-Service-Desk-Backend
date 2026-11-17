import { useState } from "react";
import { Button, Dialog, useToast } from "@/shared/ui";

function personName(person) {
  return person.fullName || person.userName;
}

/**
 * Name the Department Admin: one of the heads or deputies of the department's active units (the
 * only people the API accepts), or nobody. The API's refusals show as the dialog's message.
 */
export default function AdminDialog({ department, onClose, onSave }) {
  const toast = useToast();
  const candidates = [];
  for (const unit of department.units.filter((u) => u.isActive)) {
    for (const [person, post] of [
      [unit.head, "Head"],
      [unit.deputy, "Deputy"],
    ]) {
      if (person && !candidates.some((c) => c.person.id === person.id))
        candidates.push({ person, post: `${post} of ${unit.name}` });
    }
  }
  const [userId, setUserId] = useState(department.admin?.id ?? "");
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      const result = await onSave(userId || null);
      toast.success(result.message);
      onClose();
    } catch (error) {
      setFailure(error.message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Department Admin of ${department.name}`}
      description="Sees every ticket in the department and reassigns anywhere in it, like the HOD. Must head or deputise one of its units."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="admin-form" busy={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="admin-form" onSubmit={save} noValidate className="space-y-3">
        {failure && (
          <p
            role="alert"
            className="rounded-[6px] border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
          >
            {failure}
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-semibold text-ink">
            Department Admin
          </legend>
          <ul className="mt-2 divide-y divide-line rounded-[6px] border border-line">
            {candidates.map(({ person, post }) => (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="department-admin"
                    checked={userId === person.id}
                    onChange={() => setUserId(person.id)}
                    className="h-4 w-4"
                  />
                  <span className="text-ink">{personName(person)}</span>
                  <span className="text-xs text-muted">{post}</span>
                </label>
              </li>
            ))}
            <li>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="department-admin"
                  checked={userId === ""}
                  onChange={() => setUserId("")}
                  className="h-4 w-4"
                />
                <span className="text-ink">No Department Admin</span>
              </label>
            </li>
          </ul>
          {candidates.length === 0 && (
            <p className="mt-2 text-xs text-muted">
              No unit of {department.name} has a head or deputy yet.
            </p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
