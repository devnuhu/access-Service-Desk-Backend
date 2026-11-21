import { useParams } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { unitPlace, useMyOrganisation } from "@/features/org";
import { MessageCard, PageHeader, Spinner, UnitEyebrow } from "@/shared/ui";
import UnitAvailabilityCard from "../components/UnitAvailabilityCard.jsx";
import {
  useDepartmentAvailability,
  useUnitAvailability,
} from "../hooks/useAvailability.js";

function Loading() {
  return (
    <div className="py-10 text-center text-muted">
      <Spinner label="Loading…" />
    </div>
  );
}

/** A refusal from the server (403 / 404) shows its own message. */
function Refused({ error }) {
  return (
    <MessageCard icon={ShieldOff} title="This page cannot be shown">
      <p>{error.message}</p>
    </MessageCard>
  );
}

/** /availability/units/:unitId: the unit's people and who is available today. */
export function UnitAvailabilityPage() {
  const { unitId } = useParams();
  const unit = useUnitAvailability(unitId);
  const org = useMyOrganisation();
  if (unit.isLoading) return <Loading />;
  if (unit.isError) return <Refused error={unit.error} />;
  const place = unitPlace(org.data, unitId, unit.data.departmentId);
  return (
    <div className="space-y-4">
      <PageHeader
        back="/"
        eyebrow={
          <UnitEyebrow
            unitName={unit.data.name}
            departmentName={place?.departmentName}
          />
        }
        title={`${unit.data.name} availability`}
        description="Who is in today, who is away, and who covers their work."
      />
      <UnitAvailabilityCard unit={unit.data} />
    </div>
  );
}

/** /availability/departments/:departmentId: every unit of the department (the HOD's overview). */
export function DepartmentAvailabilityPage() {
  const { departmentId } = useParams();
  const units = useDepartmentAvailability(departmentId);
  if (units.isLoading) return <Loading />;
  if (units.isError) return <Refused error={units.error} />;
  const available = units.data.reduce(
    (sum, unit) => sum + unit.availableCount,
    0,
  );
  const total = units.data.reduce((sum, unit) => sum + unit.memberCount, 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Department availability"
        description={`${available} of ${total} available today across ${units.data.length} ${units.data.length === 1 ? "unit" : "units"}.`}
      />
      {units.data.length === 0 ? (
        <p className="text-sm text-muted">No active units.</p>
      ) : (
        units.data.map((unit) => (
          <UnitAvailabilityCard key={unit.unitId} unit={unit} />
        ))
      )}
    </div>
  );
}
