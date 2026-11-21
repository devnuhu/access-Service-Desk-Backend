import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  bulkAcknowledge,
  bulkPick,
  bulkReassign,
  bulkResolve,
  createSavedView,
  deleteSavedView,
  listSavedViews,
  markTicketRead,
  updateSavedView,
} from "../api/endpoints.js";
import { refreshTickets, ticketKeys } from "./useTickets.js";

/**
 * Tells the server I opened the ticket (POST /read), once per ticket opened, never on a poll or a
 * refetch. Then every cached list shows the row as read, without fetching the lists again.
 */
export function useMarkRead(ticketId) {
  const queryClient = useQueryClient();
  const sent = useRef(null);
  useEffect(() => {
    if (!ticketId || sent.current === ticketId) return;
    sent.current = ticketId;
    request(markTicketRead, { params: { ticketId } })
      .then(() =>
        queryClient.setQueriesData({ queryKey: ticketKeys.lists }, (data) =>
          data?.items
            ? {
                ...data,
                items: data.items.map((item) =>
                  item.id === ticketId ? { ...item, unread: false } : item,
                ),
              }
            : data,
        ),
      )
      // Not being able to mark it read changes nothing on the page.
      .catch(() => {});
  }, [ticketId, queryClient]);
}

const BULK = {
  pick: bulkPick,
  acknowledge: bulkAcknowledge,
  reassign: bulkReassign,
  resolve: bulkResolve,
};

/**
 * One bulk action ({ action, ...body }). Always answers per ticket, so a partly failed batch is a
 * result, not an error; every ticket query refreshes afterwards.
 */
export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...body }) => request(BULK[action], { body }),
    onSettled: () => refreshTickets(queryClient),
  });
}

export const VIEWS_KEY = ["views"];

export function useSavedViews() {
  return useQuery({
    queryKey: VIEWS_KEY,
    queryFn: () => request(listSavedViews),
  });
}

function useViewMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: VIEWS_KEY }),
  });
}

export const useCreateView = () =>
  useViewMutation((body) => request(createSavedView, { body }));

export const useUpdateView = () =>
  useViewMutation(({ viewId, ...body }) =>
    request(updateSavedView, { params: { viewId }, body }),
  );

export const useDeleteView = () =>
  useViewMutation((viewId) => request(deleteSavedView, { params: { viewId } }));
