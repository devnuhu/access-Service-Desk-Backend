import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  acknowledgeTicket,
  addComment,
  cancelTicket,
  checkDuplicates,
  confirmTicket,
  escalateTicket,
  createTicket,
  downloadAttachment,
  getReassignOptions,
  getTicket,
  getTicketActions,
  getTicketByReference,
  listAssignments,
  listLocations,
  listTickets,
  reassignTicket,
  reopenTicket,
  resolveTicket,
  resumeTicket,
  setTicketPending,
} from "../api/endpoints.js";

export const PAGE_SIZE = 20;

export const ticketKeys = {
  /** Prefix of every ticket query (lists, counts, ticket pages): a pushed "Ticket" refetches them. */
  all: ["tickets"],
  lists: ["tickets", "list"],
  list: (query) => ["tickets", "list", query],
  /** Prefix of every ticket page. */
  tickets: ["tickets", "detail"],
  ticket: ({ reference, id }) =>
    reference
      ? ["tickets", "detail", reference]
      : ["tickets", "detail", "id", id],
  locations: (forUserId) => ["tickets", "locations", forUserId ?? "me"],
  actions: (ticketId) => ["tickets", "actions", ticketId],
  /** Reassign options and history of one ticket (staff only); under "tickets", so a push refetches them. */
  assignment: (ticketId) => ["tickets", "assignment", ticketId],
  reassignOptions: (ticketId) => ["tickets", "assignment", ticketId, "options"],
  history: (ticketId) => ["tickets", "assignment", ticketId, "history"],
};

export function useLocationChoices(forUserId) {
  return useQuery({
    queryKey: ticketKeys.locations(forUserId),
    queryFn: () =>
      request(listLocations, { query: forUserId ? { forUserId } : {} }),
  });
}

/** One page of a list (view mine, copied or department), server-side status and search. */
export function useTicketList(query, { enabled = true } = {}) {
  return useQuery({
    queryKey: ticketKeys.list(query),
    queryFn: () => request(listTickets, { query }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/** A ticket by reference (or by id for /tickets/id/:id). 404 is not retried: it means "no access". */
export function useTicket({ reference, id }) {
  return useQuery({
    queryKey: ticketKeys.ticket({ reference, id }),
    queryFn: () =>
      reference
        ? request(getTicketByReference, { params: { reference } })
        : request(getTicket, { params: { ticketId: id } }),
    enabled: Boolean(reference || id),
    retry: (count, error) => error?.status !== 404 && count < 2,
  });
}

export function checkForDuplicates(body) {
  return request(checkDuplicates, { body });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => request(createTicket, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
      queryClient.invalidateQueries({ queryKey: ["tickets", "locations"] });
    },
  });
}

export function useAddComment(ticketId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => request(addComment, { params: { ticketId }, body }),
    // A requester's reply can resume a Pending ticket, so the actions refetch too.
    onSuccess: () => refreshTickets(queryClient),
  });
}

/**
 * Downloads through the HTTP client (so the 401-refresh rules apply) and saves the file under the
 * server's name. Never opened inline.
 */
export async function downloadFile(ticketId, attachment) {
  const { blob, fileName } = await request(downloadAttachment, {
    params: { ticketId, attachmentId: attachment.id },
  });
  const name = fileName === "download" ? attachment.fileName : fileName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Staff only: never call these for a requester or a copied colleague (they would get 403). */
export function useReassignOptions(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ticketKeys.reassignOptions(ticketId),
    queryFn: () => request(getReassignOptions, { params: { ticketId } }),
    enabled: Boolean(ticketId) && enabled,
  });
}

export function useAssignmentHistory(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ticketKeys.history(ticketId),
    queryFn: () => request(listAssignments, { params: { ticketId } }),
    enabled: Boolean(ticketId) && enabled,
  });
}

/** After any change (or a 409): the ticket, its actions, options and history, and the lists. */
export function refreshTickets(queryClient) {
  return queryClient.invalidateQueries({ queryKey: ticketKeys.all });
}

export function useReassign(ticketId) {
  return useMutation({
    mutationFn: (body) =>
      request(reassignTicket, { params: { ticketId }, body }),
  });
}

/** For everyone who can see the ticket: which workflow buttons to show. */
export function useTicketActions(ticketId) {
  return useQuery({
    queryKey: ticketKeys.actions(ticketId),
    queryFn: () => request(getTicketActions, { params: { ticketId } }),
    enabled: Boolean(ticketId),
  });
}

const WORKFLOW = {
  acknowledge: acknowledgeTicket,
  pending: setTicketPending,
  resume: resumeTicket,
  resolve: resolveTicket,
  confirm: confirmTicket,
  reopen: reopenTicket,
  cancel: cancelTicket,
  escalate: escalateTicket,
};

/** One workflow action: `mutateAsync({ action, body })`, action being a key of WORKFLOW. */
export function useWorkflowAction(ticketId) {
  return useMutation({
    mutationFn: ({ action, body }) =>
      request(WORKFLOW[action], {
        params: { ticketId },
        ...(body ? { body } : {}),
      }),
  });
}
