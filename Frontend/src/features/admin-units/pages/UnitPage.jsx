import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Grid3x3, UserPlus } from "lucide-react";
import { useUnitSkills } from "@/features/admin-catalogue";
import { formatWat } from "@/shared/lib/time";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  Dialog,
  MessageCard,
  Spinner,
  useToast,
} from "@/shared/ui";
import { STAFF_CATEGORY } from "../api/endpoints.js";
import PickPersonDialog from "../components/PickPersonDialog.jsx";
import RenameDialog from "../components/RenameDialog.jsx";
import {
  useAddMember,
  useAdminDepartments,
  useRemoveMember,
  useSetDeputy,
  useSetHead,
  useUnitMembers,
  useUpdateUnit,
} from "../hooks/useUnits.js";

const name = (person) => (person ? person.fullName || person.userName : null);

function Post({ title, hint, person, onChange, onClear, changeDisabled }) {
  return (
    <div className="flex-1 rounded-card border border-line p-4">
      <h3 className="text-xs font-semibold text-muted uppercase">{title}</h3>
      <p className="mt-1 text-sm font-semibold text-ink">
        {name(person) ?? <span className="font-normal text-muted">None</span>}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onChange}
          disabled={changeDisabled}
        >
          Change
        </Button>
        {person && (
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** One unit (Super Admin): head, deputy and members. */
export default function UnitPage() {
  const { unitId } = useParams();
  const toast = useToast();
  const departments = useAdminDepartments();
  const members = useUnitMembers(unitId);
  const skills = useUnitSkills(unitId);
  const setHead = useSetHead();
  const setDeputy = useSetDeputy();
  const addMember = useAddMember();
  const removeMember = useRemoveMember();
  const updateUnit = useUpdateUnit();
  const [dialog, setDialog] = useState(null);
  const [staffNo, setStaffNo] = useState("");
  const [deputyId, setDeputyId] = useState("");

  const department = departments.data?.find((d) =>
    d.units.some((u) => u.id === unitId),
  );
  const unit = department?.units.find((u) => u.id === unitId);

  const report = (promise) =>
    promise.then(
      (result) => {
        toast.success(result.message);
        return true;
      },
      (error) => {
        toast.error(error.message);
        return false;
      },
    );
  const done = (ok) => ok && setDialog(null);

  if (departments.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (departments.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {departments.error.message}
      </p>
    );
  }
  if (!unit) {
    return (
      <MessageCard
        title="Unit not found"
        linkTo="/admin/units"
        linkText="Back to Units"
      >
        <p>This unit does not exist, or it was removed.</p>
      </MessageCard>
    );
  }

  const rows = members.data ?? [];
  // How many of the unit's categories each member handles (from the skills matrix).
  const categoryCount = new Map(
    (skills.data?.members ?? []).map((m) => [m.userId, m.categoryIds.length]),
  );
  const candidates = rows.filter((member) => !member.isHead);

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
          <li>
            <Link
              to="/admin/units"
              className="font-semibold text-brand-navy hover:underline"
            >
              Units
            </Link>
          </li>
          <ChevronRight aria-hidden="true" size={14} />
          <li>{department.name}</li>
          <ChevronRight aria-hidden="true" size={14} />
          <li aria-current="page" className="text-ink">
            {unit.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {unit.name}
          <Chip tone="grey">{unit.code}</Chip>
          {!unit.isActive && <Chip tone="red">Off</Chip>}
        </h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("rename")}
          >
            Rename
          </Button>
          <Button
            size="sm"
            variant={unit.isActive ? "danger" : "secondary"}
            onClick={() => setDialog("toggle")}
          >
            {unit.isActive ? "Switch off" : "Switch on"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <Post
          title="Head of Unit"
          hint="The head also works tickets in the unit. The previous head stays as a case worker."
          person={unit.head}
          onChange={() => setDialog("head")}
          onClear={() => setDialog("clearHead")}
        />
        <Post
          title="Deputy"
          hint="Receives escalations when the head is on leave."
          person={unit.deputy}
          onChange={() => {
            setDeputyId(unit.deputy?.userId ?? "");
            setDialog("deputy");
          }}
          onClear={() => setDialog("clearDeputy")}
          changeDisabled={candidates.length === 0}
        />
      </div>

      <Card>
        <CardHeader
          title="Members"
          description="The case workers of this unit. A person is in at most one unit per department."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/admin/units/${unitId}/skills`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:bg-page"
              >
                <Grid3x3 aria-hidden="true" size={16} />
                Skills matrix
              </Link>
              <Button size="sm" onClick={() => setDialog("member")}>
                <UserPlus aria-hidden="true" size={16} />
                Add member
              </Button>
            </div>
          }
        />
        {members.isLoading ? (
          <div className="px-5 py-8 text-center text-muted">
            <Spinner label="Loading members…" />
          </div>
        ) : members.isError ? (
          <p role="alert" className="px-5 py-8 text-center text-sm text-danger">
            {members.error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            No members yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-page text-xs font-semibold text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-2.5">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Staff no.
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Staff category
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Categories
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Account
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Joined
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((member) => {
                  const post = member.isHead
                    ? "head"
                    : member.isDeputy
                      ? "deputy"
                      : null;
                  return (
                    <tr key={member.userId}>
                      <td className="px-5 py-3">
                        <span className="font-semibold text-ink">
                          {member.fullName || member.userName}
                        </span>
                        <span className="block text-xs text-muted">
                          {member.userName}
                        </span>
                      </td>
                      <td className="px-5 py-3">{member.staffNo || "—"}</td>
                      <td className="px-5 py-3">
                        <span className="flex flex-wrap gap-1">
                          <Chip
                            tone={
                              member.staffCategory === STAFF_CATEGORY.HeadOfUnit
                                ? "navy"
                                : "grey"
                            }
                          >
                            {member.staffCategory === STAFF_CATEGORY.HeadOfUnit
                              ? "Head of Unit"
                              : "Employee"}
                          </Chip>
                          {member.isHead && <Chip tone="orange">Head</Chip>}
                          {member.isDeputy && <Chip tone="orange">Deputy</Chip>}
                        </span>
                      </td>
                      <td
                        className="px-5 py-3 tabular-nums"
                        data-testid={`categories-${member.userId}`}
                      >
                        {skills.data
                          ? (categoryCount.get(member.userId) ?? 0)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Chip tone={member.accountActive ? "green" : "red"}>
                          {member.accountActive ? "Active" : "Blocked"}
                        </Chip>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {formatWat(member.joinedAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          title={post ? `Change the ${post} first` : undefined}
                        >
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={Boolean(post)}
                            onClick={() => setDialog({ remove: member })}
                            aria-label={`Remove ${member.fullName || member.userName}`}
                          >
                            Remove
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PickPersonDialog
        open={dialog === "head"}
        onClose={() => setDialog(null)}
        title={`Set the head of ${unit.name}`}
        description="The head is added as a member of the unit."
        onPick={async (person) =>
          done(await report(setHead.mutateAsync({ unitId, userId: person.id })))
        }
      />
      <PickPersonDialog
        open={dialog === "member"}
        onClose={() => {
          setStaffNo("");
          setDialog(null);
        }}
        title={`Add a member to ${unit.name}`}
        confirmLabel="Add member"
        busy={addMember.isPending}
        exclude={rows.map((member) => member.userId)}
        onPick={async (person) => {
          const ok = await report(
            addMember.mutateAsync({
              unitId,
              userId: person.id,
              staffNo: staffNo.trim(),
            }),
          );
          if (ok) setStaffNo("");
          done(ok);
        }}
      >
        <div>
          <label
            htmlFor="staff-no"
            className="block text-sm font-semibold text-ink"
          >
            Staff number{" "}
            <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="staff-no"
            value={staffNo}
            maxLength={30}
            onChange={(event) => setStaffNo(event.target.value)}
            className="mt-1 h-10 w-full rounded-[6px] border border-line px-3 text-sm text-ink"
          />
        </div>
      </PickPersonDialog>

      <Dialog
        open={dialog === "deputy"}
        onClose={() => setDialog(null)}
        title={`Set the deputy of ${unit.name}`}
        description="The deputy must already be a member of the unit."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!deputyId}
              busy={setDeputy.isPending}
              onClick={async () =>
                done(
                  await report(
                    setDeputy.mutateAsync({ unitId, userId: deputyId }),
                  ),
                )
              }
            >
              Set deputy
            </Button>
          </>
        }
      >
        <fieldset>
          <legend className="sr-only">Members</legend>
          <ul className="space-y-1">
            {candidates.map((member) => (
              <li key={member.userId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-page">
                  <input
                    type="radio"
                    name="deputy"
                    value={member.userId}
                    checked={deputyId === member.userId}
                    onChange={() => setDeputyId(member.userId)}
                  />
                  <span className="font-medium text-ink">
                    {member.fullName || member.userName}
                  </span>
                  <span className="text-xs text-muted">{member.userName}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </Dialog>

      <ConfirmDialog
        open={dialog === "clearHead" || dialog === "clearDeputy"}
        title={dialog === "clearHead" ? "Clear the head?" : "Clear the deputy?"}
        message={
          dialog === "clearHead"
            ? `${unit.name} will have no Head of Unit. ${name(unit.head)} stays as a case worker.`
            : `${unit.name} will have no deputy. ${name(unit.deputy)} stays as a case worker.`
        }
        confirmLabel="Clear"
        danger
        busy={setHead.isPending || setDeputy.isPending}
        onConfirm={async () => {
          const mutation = dialog === "clearHead" ? setHead : setDeputy;
          await report(mutation.mutateAsync({ unitId, userId: null }));
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(dialog?.remove)}
        title="Remove this member?"
        message={`${name(dialog?.remove)} will no longer work tickets in ${unit.name}. Their history is kept.`}
        confirmLabel="Remove"
        danger
        busy={removeMember.isPending}
        onConfirm={async () => {
          await report(
            removeMember.mutateAsync({ unitId, userId: dialog.remove.userId }),
          );
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
      {dialog === "rename" && (
        <RenameDialog
          open
          onClose={() => setDialog(null)}
          title={`Rename ${unit.name}`}
          initialName={unit.name}
          onSave={(newName) =>
            updateUnit.mutateAsync({ unitId, name: newName })
          }
        />
      )}
      <ConfirmDialog
        open={dialog === "toggle"}
        title={
          unit.isActive ? `Switch off ${unit.name}?` : `Switch on ${unit.name}?`
        }
        message={
          unit.isActive
            ? "It stops receiving tickets. Remove its members (and its head) first."
            : "It can receive tickets again."
        }
        confirmLabel={unit.isActive ? "Switch off" : "Switch on"}
        danger={unit.isActive}
        busy={updateUnit.isPending}
        onConfirm={async () => {
          await report(
            updateUnit.mutateAsync({ unitId, isActive: !unit.isActive }),
          );
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
