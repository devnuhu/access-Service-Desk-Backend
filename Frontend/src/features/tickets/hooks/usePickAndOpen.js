import { useNavigate } from "react-router-dom";
import { useToast } from "@/shared/ui";
import { usePickTicket } from "./useTickets.js";

/**
 * Pick a ticket, then open it. 409 (someone else took it, or it left New): "Someone else took it"
 * and the pool refreshes (every ticket query does after a pick). Any other refusal (403 not your
 * unit or category, 400 unavailable today, 404) shows the server's message as it is.
 * `picking`: the id being picked. `open: false` stays on the page (the ticket page itself).
 */
export default function usePickAndOpen() {
  const toast = useToast();
  const navigate = useNavigate();
  const pick = usePickTicket();

  const run = async (ticket, { open = true } = {}) => {
    try {
      const result = await pick.mutateAsync(ticket.id);
      toast.success(result.message, { title: `${ticket.reference} is yours` });
      if (open) navigate(`/tickets/id/${ticket.id}`);
    } catch (error) {
      if (error.status === 409)
        toast.warning("Someone else took it.", {
          title: `${ticket.reference} not picked`,
        });
      else
        toast.error(error.message, { title: `${ticket.reference} not picked` });
    }
  };

  return { pick: run, picking: pick.isPending ? pick.variables : null };
}
