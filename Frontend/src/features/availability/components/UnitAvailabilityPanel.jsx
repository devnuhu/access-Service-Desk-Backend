import { ShieldOff } from "lucide-react";
import { MessageCard, Spinner } from "@/shared/ui";
import { useUnitAvailability } from "../hooks/useAvailability.js";
import UnitAvailabilityCard from "./UnitAvailabilityCard.jsx";

/** A unit's availability without a page header (the Availability tab of My unit). */
export default function UnitAvailabilityPanel({ unitId }) {
  const unit = useUnitAvailability(unitId);
  if (unit.isLoading)
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  if (unit.isError)
    return (
      <MessageCard icon={ShieldOff} title="This cannot be shown">
        <p>{unit.error.message}</p>
      </MessageCard>
    );
  return <UnitAvailabilityCard unit={unit.data} />;
}
