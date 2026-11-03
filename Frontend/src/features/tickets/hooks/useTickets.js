import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  addComment,
  checkDuplicates,
  createTicket,
  downloadAttachment,
  getTicket,
  getTicketByReference,
  listLocations,
  listTickets,
  OPEN_STATUSES,
} from "../api/endpoints.js";

export const PAGE_SIZE = 20;
/** The server's largest page; the "Open" work queue reads this many per status. */
export const OPEN_PAGE_SIZE = 100;

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

/**
 * The open tickets of a list: one call per open status (the API filters by one status at a time),
 * merged newest first. `truncated` is true when a status has more than OPEN_PAGE_SIZE tickets.
 */
export function useOpenTickets(
  query,
  { enabled = true, pageSize = OPEN_PAGE_SIZE } = {},
) {
  return useQueries({
    queries: OPEN_STATUSES.map((status) => {
      const full = { ...query, status, page: 1, pageSize };
      return {
        queryKey: ticketKeys.list(full),
        queryFn: () => request(listTickets, { query: full }),
        enabled,
      };
    }),
    combine: (results) => {
      const isLoading = results.some((result) => result.isLoading);
      const error = results.find((result) => result.error)?.error ?? null;
      const items = results
        .flatMap((result) => result.data?.items ?? [])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const total = results.reduce(
        (sum, result) => sum + (result.data?.total ?? 0),
        0,
      );
      const truncated = results.some(
        (result) => (result.data?.total ?? 0) > pageSize,
      );
      return { isLoading, error, items, total, truncated };
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.tickets });
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
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
