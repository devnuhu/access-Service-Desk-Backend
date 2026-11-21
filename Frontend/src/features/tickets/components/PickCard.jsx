import { Hand } from "lucide-react";
import { useMyOrganisation } from "@/features/org";
import { Button, Card } from "@/shared/ui";
import { STATUS } from "../api/endpoints.js";
import usePickAndOpen from "../hooks/usePickAndOpen.js";

/**
 * "Pick this ticket" while it is New and I work in its unit (org/me). The server decides: a 403
 * (not mapped to the category) or a 400 (unavailable today) shows its message.
 */
export default function PickCard({ ticket }) {
  const org = useMyOrganisation();
  const { pick, picking } = usePickAndOpen();
  const inUnit = (org.data?.departments ?? []).some((department) =>
    department.units.some((unit) => unit.id === ticket.unitId && unit.isMember),
  );
  if (ticket.status !== STATUS.New || !inUnit) return null;

  return (
    <Card className="px-5 py-4" data-testid="pick-card">
      <h2 className="text-sm font-semibold">Nobody holds this yet</h2>
      <p className="mt-1 text-sm text-body">
        It is waiting in the {ticket.unitName} pool. Pick it to make it yours.
      </p>
      <Button
        className="mt-3 w-full"
        busy={picking === ticket.id}
        onClick={() => pick(ticket, { open: false })}
      >
        <Hand aria-hidden="true" size={16} />
        Pick this ticket
      </Button>
    </Card>
  );
}
