import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  addTicketTask,
  cancelTicketTask,
  listMyTasks,
  listTaskOwners,
  listTicketTasks,
  rejectTicketTask,
  removeTicketTask,
  setTicketTaskDone,
  updateTicketTask,
} from "../api/endpoints.js";

/** Under "tickets", so a pushed ticket change and refreshTickets refetch it too. */
export const tasksKey = (ticketId) => ["tickets", ticketId, "tasks"];

/**
 * The ticket's tasks: all of them for its staff, only their own for a person given a task there.
 * Pass enabled false for a requester who is not staff (they would get 404). A 403 or 404 is final.
 */
export function useTicketTasks(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: tasksKey(ticketId),
    queryFn: () => request(listTicketTasks, { params: { ticketId } }),
    enabled: enabled && Boolean(ticketId),
    retry: (count, error) => ![403, 404].includes(error?.status) && count < 2,
  });
}

/** Under "tickets" too, so a ticket change (and any task change) refetches it. */
export const MY_TASKS_KEY = ["tickets", "my-tasks"];

/** Tasks given to me, one page at a time: `{ status, dateField, from, to, page, pageSize }`. */
export function useMyTasks(query, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...MY_TASKS_KEY, query],
    queryFn: () => request(listMyTasks, { query }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** The My tasks badge: openCount from one row (it ignores every filter). */
export const useMyTaskCount = ({ enabled = true } = {}) =>
  useMyTasks({ page: 1, pageSize: 1 }, { enabled });

/**
 * Who can own a task: the ticket's department (staff only). Rarely changes, so kept 5 minutes, and
 * outside tasksKey so a task change does not refetch it.
 */
export function useTaskOwners(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["tickets", ticketId, "task-owners"],
    queryFn: () => request(listTaskOwners, { params: { ticketId } }),
    enabled: enabled && Boolean(ticketId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Refetch the tasks (their open count included), for example after a refused resolve. */
export function refreshTasks(queryClient, ticketId) {
  return queryClient.invalidateQueries({ queryKey: tasksKey(ticketId) });
}

function useTaskMutation(ticketId, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        refreshTasks(queryClient, ticketId),
        queryClient.invalidateQueries({ queryKey: MY_TASKS_KEY }),
      ]),
  });
}

/** `mutateAsync({ title, assigneeUserId, dueDate })`. */
export const useAddTask = (ticketId) =>
  useTaskMutation(ticketId, (body) =>
    request(addTicketTask, { params: { ticketId }, body }),
  );

/** `mutateAsync({ taskId, body })`. */
export const useUpdateTask = (ticketId) =>
  useTaskMutation(ticketId, ({ taskId, body }) =>
    request(updateTicketTask, { params: { ticketId, taskId }, body }),
  );

/** `mutateAsync({ taskId, done })`. */
export const useSetTaskDone = (ticketId) =>
  useTaskMutation(ticketId, ({ taskId, done }) =>
    request(setTicketTaskDone, {
      params: { ticketId, taskId },
      body: { done },
    }),
  );

/** `mutateAsync(taskId)`. */
export const useRemoveTask = (ticketId) =>
  useTaskMutation(ticketId, (taskId) =>
    request(removeTicketTask, { params: { ticketId, taskId } }),
  );

/** `mutateAsync({ taskId, reason })`: the owner sends the task back. */
export const useRejectTask = (ticketId) =>
  useTaskMutation(ticketId, ({ taskId, reason }) =>
    request(rejectTicketTask, {
      params: { ticketId, taskId },
      body: { reason },
    }),
  );

/** `mutateAsync({ taskId, reason })`: the task is no longer needed. */
export const useCancelTask = (ticketId) =>
  useTaskMutation(ticketId, ({ taskId, reason }) =>
    request(cancelTicketTask, {
      params: { ticketId, taskId },
      body: { reason },
    }),
  );
