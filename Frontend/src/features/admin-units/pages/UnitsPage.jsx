import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Spinner } from "@/shared/ui";
import DepartmentCard from "../components/DepartmentCard.jsx";
import OrgItemDialog from "../components/OrgItemDialog.jsx";
import { useAdminDepartments, useCreateDepartment } from "../hooks/useUnits.js";

/** Administration > Units: departments, their HOD and units (Super Admin). */
export default function UnitsPage() {
  const departments = useAdminDepartments();
  const create = useCreateDepartment();
  const [adding, setAdding] = useState(false);

  const list = [...(departments.data ?? [])].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Units</h1>
          <p className="mt-1 text-sm text-muted">
            Departments, their units and people. Case Worker, Head of Unit and
            Head of Department roles follow what is set here.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" size={16} />
          Add department
        </Button>
      </div>

      {departments.isLoading ? (
        <div className="py-10 text-center text-muted">
          <Spinner label="Loading departments…" />
        </div>
      ) : departments.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-danger">
          {departments.error.message}
        </p>
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          No departments yet.
        </p>
      ) : (
        list.map((department) => (
          <DepartmentCard key={department.id} department={department} />
        ))
      )}

      <OrgItemDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add department"
        codeHint="Used as the ticket reference prefix, for example CP. Cannot be changed later."
        onSave={(values) => create.mutateAsync(values)}
      />
    </div>
  );
}
