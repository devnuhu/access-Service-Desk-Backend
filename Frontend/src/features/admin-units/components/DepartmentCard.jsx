import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button, Card, Chip, ConfirmDialog, useToast } from "@/shared/ui";
import {
  useCreateUnit,
  useSetAdmin,
  useSetHod,
  useUpdateDepartment,
} from "../hooks/useUnits.js";
import AdminDialog from "./AdminDialog.jsx";
import OrgItemDialog from "./OrgItemDialog.jsx";
import PickPersonDialog from "./PickPersonDialog.jsx";
import RenameDialog from "./RenameDialog.jsx";

function personName(person) {
  return person ? person.fullName || person.userName : null;
}

/** One department: header with the HOD and actions, then its units. */
export default function DepartmentCard({ department }) {
  const toast = useToast();
  const setHod = useSetHod();
  const setAdmin = useSetAdmin();
  const update = useUpdateDepartment();
  const createUnit = useCreateUnit();
  const [dialog, setDialog] = useState(null);

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

  const pickHod = async (person) => {
    if (
      await report(
        setHod.mutateAsync({ departmentId: department.id, userId: person.id }),
      )
    )
      setDialog(null);
  };

  const toggle = async () => {
    await report(
      update.mutateAsync({
        departmentId: department.id,
        isActive: !department.isActive,
      }),
    );
    setDialog(null);
  };

  const hod = personName(department.hod);
  const admin = personName(department.admin);
  const units = [...department.units].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );

  return (
    <Card
      className={department.isActive ? "" : "opacity-70"}
      aria-labelledby={`department-${department.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2
            id={`department-${department.id}`}
            className="flex flex-wrap items-center gap-2 text-base font-semibold"
          >
            {department.name}
            <Chip tone="grey">{department.code}</Chip>
            {!department.isActive && <Chip tone="red">Off</Chip>}
          </h2>
          <p className="mt-1 text-sm">
            <span className="text-muted">Head of Department: </span>
            {hod ? (
              <span className="text-ink">{hod}</span>
            ) : (
              <span className="text-muted">No HOD</span>
            )}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="text-muted">Department Admin: </span>
            {admin ? (
              <span className="text-ink" data-testid="department-admin">
                {admin}
              </span>
            ) : (
              <span className="text-muted">None</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("hod")}
          >
            Set HOD
          </Button>
          {department.hod && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog("clearHod")}
            >
              Clear HOD
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("admin")}
          >
            Department Admin
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDialog("rename")}
          >
            Rename
          </Button>
          <Button
            size="sm"
            variant={department.isActive ? "danger" : "secondary"}
            onClick={() => setDialog("toggle")}
          >
            {department.isActive ? "Switch off" : "Switch on"}
          </Button>
        </div>
      </div>

      {units.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No units yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-page/60 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <tr>
                <th scope="col" className="px-5 py-4">
                  Code
                </th>
                <th scope="col" className="px-5 py-4">
                  Name
                </th>
                <th scope="col" className="px-5 py-4">
                  Head
                </th>
                <th scope="col" className="px-5 py-4">
                  Members
                </th>
                <th scope="col" className="px-5 py-4">
                  Status
                </th>
                <th scope="col" className="px-5 py-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {units.map((unit) => (
                <tr key={unit.id} className={unit.isActive ? "" : "text-muted"}>
                  <td className="px-5 py-3 font-mono text-xs">{unit.code}</td>
                  <td className="px-5 py-3 font-medium text-ink">
                    {unit.name}
                  </td>
                  <td className="px-5 py-3">
                    {personName(unit.head) ?? (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{unit.memberCount}</td>
                  <td className="px-5 py-3">
                    <Chip tone={unit.isActive ? "green" : "red"}>
                      {unit.isActive ? "On" : "Off"}
                    </Chip>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      to={`/admin/units/${unit.id}`}
                      className="font-semibold text-brand-navy hover:underline"
                      aria-label={`Manage ${unit.name}`}
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-line px-5 py-3">
        <Button size="sm" variant="secondary" onClick={() => setDialog("unit")}>
          <Plus aria-hidden="true" size={16} />
          Add unit
        </Button>
      </div>

      <PickPersonDialog
        open={dialog === "hod"}
        onClose={() => setDialog(null)}
        title={`Set HOD of ${department.name}`}
        description="The HOD oversees the department and cannot be a member of one of its units."
        onPick={pickHod}
      />
      <ConfirmDialog
        open={dialog === "clearHod"}
        title="Clear the HOD?"
        message={`${department.name} will have no Head of Department.`}
        confirmLabel="Clear HOD"
        danger
        busy={setHod.isPending}
        onConfirm={async () => {
          await report(
            setHod.mutateAsync({ departmentId: department.id, userId: null }),
          );
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
      {dialog === "admin" && (
        <AdminDialog
          department={department}
          onClose={() => setDialog(null)}
          onSave={(userId) =>
            setAdmin.mutateAsync({ departmentId: department.id, userId })
          }
        />
      )}
      {dialog === "rename" && (
        <RenameDialog
          open
          onClose={() => setDialog(null)}
          title={`Rename ${department.name}`}
          initialName={department.name}
          onSave={(name) =>
            update.mutateAsync({ departmentId: department.id, name })
          }
        />
      )}
      <ConfirmDialog
        open={dialog === "toggle"}
        title={
          department.isActive
            ? `Switch off ${department.name}?`
            : `Switch on ${department.name}?`
        }
        message={
          department.isActive
            ? "It stops receiving tickets. Switch off its units first."
            : "It can receive tickets again."
        }
        confirmLabel={department.isActive ? "Switch off" : "Switch on"}
        danger={department.isActive}
        busy={update.isPending}
        onConfirm={toggle}
        onCancel={() => setDialog(null)}
      />
      <OrgItemDialog
        open={dialog === "unit"}
        onClose={() => setDialog(null)}
        title={`Add a unit to ${department.name}`}
        codeHint="Cannot be changed later."
        onSave={(values) =>
          createUnit.mutateAsync({ departmentId: department.id, ...values })
        }
      />
    </Card>
  );
}
