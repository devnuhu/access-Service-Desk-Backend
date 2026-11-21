import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  addTicketLink,
  listTicketLinks,
  mergeTicket,
  removeTicketLink,
} from "../api/endpoints.js";
import { refreshTickets } from "./useTickets.js";

export const linksKey = (ticketId) => ["tickets", ticketId, "links"];

/** The ticket's links (staff only: pass enabled false for anyone else, who would get 404). */
export function useTicketLinks(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: linksKey(ticketId),
    queryFn: () => request(listTicketLinks, { params: { ticketId } }),
    enabled: enabled && Boolean(ticketId),
  });
}

function useLinkMutation(ticketId, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    // Both tickets show the link: every ticket query refreshes (under "tickets").
    onSettled: () => refreshTickets(queryClient),
  });
}

export const useAddLink = (ticketId) =>
  useLinkMutation(ticketId, (body) =>
    request(addTicketLink, { params: { ticketId }, body }),
  );

export const useRemoveLink = (ticketId) =>
  useLinkMutation(ticketId, (linkId) =>
    request(removeTicketLink, { params: { ticketId, linkId } }),
  );

/** Merging changes both tickets, the queues and the unit dashboards. */
export function useMergeTicket(ticketId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => request(mergeTicket, { params: { ticketId }, body }),
    onSuccess: () =>
      Promise.all([
        refreshTickets(queryClient),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]),
  });
}
