import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  addTicketTask,
  listTaskOwners,
  listTicketTasks,
  removeTicketTask,
  setTicketTaskDone,
  updateTicketTask,
} from "../api/endpoints.js";

/** Under "tickets", so a pushed ticket change and refreshTickets refetch it too. */
export const tasksKey = (ticketId) => ["tickets", ticketId, "tasks"];

/** The ticket's tasks. Staff only: pass enabled false for anyone else (they would get 404). */
export function useTicketTasks(ticketId, { enabled = true } = {}) {
  return useQuery({
    queryKey: tasksKey(ticketId),
    queryFn: () => request(listTicketTasks, { params: { ticketId } }),
    enabled: enabled && Boolean(ticketId),
  });
}

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
    onSettled: () => refreshTasks(queryClient, ticketId),
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
