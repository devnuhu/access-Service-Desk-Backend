import { useState } from "react";
import { X } from "lucide-react";
import { roleLabel, ROLES, sortRoles } from "@/shared/lib/roles";
import { formatWat } from "@/shared/lib/time";
import {
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  RoleChip,
  Spinner,
  useToast,
} from "@/shared/ui";
import {
  useAssignRole,
  usePerson,
  useRemoveRole,
  useRoles,
  useSetStatus,
} from "../hooks/usePeople.js";

const REQUESTER_HINT = "Every staff member is a Requester";

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children || "—"}</dd>
    </div>
  );
}

/** Side panel for one person: roles (give / take away) and access (block / allow). */
export default function PersonPanel({ userId, onClose }) {
  const toast = useToast();
  const person = usePerson(userId);
  const roles = useRoles();
  const assign = useAssignRole();
  const remove = useRemoveRole();
  const setStatus = useSetStatus();
  const [roleToGive, setRoleToGive] = useState("");
  const [confirm, setConfirm] = useState(null);

  const user = person.data;
  const roleByName = new Map(
    (roles.data ?? []).map((role) => [role.name, role]),
  );
  const available = (roles.data ?? []).filter(
    (role) => role.name && !user?.roles.includes(role.name),
  );

  const report = (promise) =>
    promise.then(
      (result) => toast.success(result.message),
      (error) => toast.error(error.message),
    );

  const give = () => {
    if (!roleToGive) return;
    report(assign.mutateAsync({ userId, roleId: roleToGive })).finally(() =>
      setRoleToGive(""),
    );
  };

  const runConfirm = async () => {
    const action = confirm;
    try {
      if (action.kind === "remove") {
        await report(remove.mutateAsync({ userId, roleId: action.role.id }));
      } else {
        await report(
          setStatus.mutateAsync({ userId, isActive: action.isActive }),
        );
      }
    } finally {
      setConfirm(null);
    }
  };

  const name = user?.fullName || user?.userName || "Person";

  return (
    <Dialog
      open
      onClose={onClose}
      side="right"
      title={name}
      description={user?.userName ?? undefined}
    >
      {person.isLoading ? (
        <Spinner label="Loading…" />
      ) : person.isError ? (
        <p role="alert" className="text-sm text-danger">
          {person.error.message}
        </p>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Department">{user.department}</Detail>
            <Detail label="Job title">{user.jobTitle}</Detail>
            <Detail label="Email">{user.email}</Detail>
            <Detail label="Last sign-in">
              {user.hasSignedIn
                ? formatWat(user.lastLoginAt)
                : "Not signed in yet"}
            </Detail>
          </dl>

          <section aria-labelledby="panel-roles">
            <h3 id="panel-roles" className="text-sm font-semibold">
              Roles
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="panel-roles">
              {sortRoles(user.roles).map((roleName) => {
                const role = roleByName.get(roleName);
                const isRequester = roleName === ROLES.Requester;
                return (
                  <li key={roleName}>
                    {isRequester ? (
                      <span title={REQUESTER_HINT}>
                        <RoleChip role={roleName} />
                        <span className="sr-only"> ({REQUESTER_HINT})</span>
                      </span>
                    ) : (
                      <RoleChip role={roleName}>
                        <button
                          type="button"
                          onClick={() =>
                            role && setConfirm({ kind: "remove", role })
                          }
                          disabled={!role}
                          className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                          aria-label={`Remove ${roleLabel(roleName)}`}
                        >
                          <X aria-hidden="true" size={12} />
                        </button>
                      </RoleChip>
                    )}
                  </li>
                );
              })}
            </ul>

            {available.length > 0 && (
              <div className="mt-4 flex items-end gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="give-role"
                    className="block text-xs font-semibold text-ink"
                  >
                    Give a role
                  </label>
                  <select
                    id="give-role"
                    value={roleToGive}
                    onChange={(event) => setRoleToGive(event.target.value)}
                    className="mt-1 h-10 w-full rounded-[6px] border border-line bg-white px-2 text-sm text-ink"
                  >
                    <option value="">Choose a role…</option>
                    {available.map((role) => (
                      <option key={role.id} value={role.id}>
                        {roleLabel(role.name)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={give}
                  disabled={!roleToGive}
                  busy={assign.isPending}
                >
                  Give
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby="panel-status">
            <h3 id="panel-status" className="text-sm font-semibold">
              Access
            </h3>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <Chip tone={user.isActive ? "green" : "red"}>
                {user.isActive ? "Active" : "Blocked"}
              </Chip>
              {user.isActive ? (
                <Button
                  variant="danger"
                  onClick={() =>
                    setConfirm({ kind: "status", isActive: false })
                  }
                >
                  Block access
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setConfirm({ kind: "status", isActive: true })}
                >
                  Allow access
                </Button>
              )}
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.kind === "remove"
            ? `Remove ${roleLabel(confirm.role.name)}?`
            : confirm?.isActive
              ? "Allow access?"
              : "Block access?"
        }
        message={
          confirm?.kind === "remove"
            ? `${name} will no longer have the ${roleLabel(confirm.role.name)} role.`
            : confirm?.isActive
              ? `${name} will be able to sign in again.`
              : "Blocking signs them out everywhere."
        }
        confirmLabel={
          confirm?.kind === "remove"
            ? "Remove role"
            : confirm?.isActive
              ? "Allow access"
              : "Block access"
        }
        danger={confirm?.kind === "remove" || confirm?.isActive === false}
        busy={remove.isPending || setStatus.isPending}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Dialog>
  );
}
