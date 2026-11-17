import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/ui";
import { TICKET_CONFLICT } from "../ticketText.js";
import { refreshTickets, useWorkflowAction } from "./useTickets.js";

/**
 * Runs a workflow action: the API's message as a toast, then everything about the ticket refetches.
 * A 409 says so and refetches too. `run` resolves null when the caller is done, or the error for
 * the caller to show (field errors under the fields, anything else as a message).
 */
export default function useRunAction(ticketId) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const workflow = useWorkflowAction(ticketId);

  const run = async (action, body) => {
    try {
      const { message } = await workflow.mutateAsync({ action, body });
      toast.success(message);
      await refreshTickets(queryClient);
      return null;
    } catch (error) {
      if (error.status !== 409) return error;
      toast.warning(TICKET_CONFLICT);
      await refreshTickets(queryClient);
      return null;
    }
  };

  return { run, busy: workflow.isPending };
}
