import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  createSharedReply,
  createUnitReply,
  deleteReply,
  listPlaceholders,
  listSharedReplies,
  listTicketReplies,
  listUnitReplies,
  updateReply,
} from "../api/endpoints.js";

export const REPLIES_KEY = ["canned-replies"];

/** A library: a unit's (unitId) or the shared one (unitId null). */
const libraryKey = (unitId) => [...REPLIES_KEY, "library", unitId ?? "shared"];

/** Loaded once per ticket page (a 404 means not staff: no menu). */
export function useTicketReplies(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...REPLIES_KEY, "ticket", ticketId],
    queryFn: () => request(listTicketReplies, { params: { ticketId } }),
    enabled: enabled && Boolean(ticketId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useReplyLibrary(unitId) {
  return useQuery({
    queryKey: libraryKey(unitId),
    queryFn: () =>
      unitId
        ? request(listUnitReplies, { params: { unitId } })
        : request(listSharedReplies),
  });
}

export function usePlaceholders() {
  return useQuery({
    queryKey: [...REPLIES_KEY, "placeholders"],
    queryFn: () => request(listPlaceholders),
    staleTime: Infinity,
  });
}

/** Every change refreshes the libraries and the ticket lists (their text changes). */
function useReplyMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: REPLIES_KEY }),
  });
}

/** { replyId?, title, bodyHtml }: a new reply in the library, or a change to one. */
export function useSaveReply(unitId) {
  return useReplyMutation(({ replyId, ...body }) => {
    if (replyId) return request(updateReply, { params: { replyId }, body });
    return unitId
      ? request(createUnitReply, { params: { unitId }, body })
      : request(createSharedReply, { body });
  });
}

export const useDeleteReply = () =>
  useReplyMutation((replyId) => request(deleteReply, { params: { replyId } }));
