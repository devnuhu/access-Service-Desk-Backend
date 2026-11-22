import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import { saveBlob } from "@/shared/lib/files";
import {
  createReportSchedule,
  createSavedReport,
  exportReport,
  getReportCatalogue,
  runReport,
  deleteReportSchedule,
  deleteSavedReport,
  exportSavedReport,
  listReportSchedules,
  listSavedReports,
  runSavedReport,
  updateReportSchedule,
  updateSavedReport,
  searchReportRecipients,
} from "../api/endpoints.js";

export const SAVED_REPORTS_KEY = ["reports", "saved"];
export const SCHEDULES_KEY = ["reports", "schedules"];

/** Date presets and the ready-made reports. They do not change while the app runs. */
export function useReportCatalogue() {
  return useQuery({
    queryKey: ["reports", "catalogue"],
    queryFn: () => request(getReportCatalogue),
    staleTime: Infinity,
  });
}

export function useSavedReports() {
  return useQuery({
    queryKey: SAVED_REPORTS_KEY,
    queryFn: () => request(listSavedReports),
  });
}

export function useReportSchedules() {
  return useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: () => request(listReportSchedules),
  });
}

/**
 * Runs a report on screen. A saved report with its range unchanged runs by id; anything else sends
 * the definition to POST /api/reports/run. Always with the viewer's own scope.
 */
export function useRunReport({ savedReportId, definition }) {
  return useQuery({
    queryKey: ["reports", "run", savedReportId ?? null, definition],
    queryFn: () =>
      savedReportId
        ? request(runSavedReport, { params: { id: savedReportId } })
        : request(runReport, { body: definition }),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Saves a definition as your report; it is in the list straight away (for the email dialog). */
export function useCreateSavedReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => request(createSavedReport, { body }),
    onSuccess: (report) =>
      queryClient.setQueryData(SAVED_REPORTS_KEY, (list) => [
        report,
        ...(list ?? []).filter((r) => r.id !== report.id),
      ]),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SAVED_REPORTS_KEY }),
  });
}

/** The owner changes a saved report (PUT); the list shows the change straight away. */
export function useUpdateSavedReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      request(updateSavedReport, { params: { id }, body }),
    onSuccess: (report) =>
      queryClient.setQueryData(SAVED_REPORTS_KEY, (list) =>
        (list ?? []).map((r) => (r.id === report.id ? report : r)),
      ),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SAVED_REPORTS_KEY }),
        // A schedule shows the report's name.
        queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY }),
      ]),
  });
}

/** Refreshes the saved list, for a report that answered 404 (deleted, or no longer shared). */
export function useRefreshSavedReports() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: SAVED_REPORTS_KEY }),
      queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY }),
    ]);
}

/** Deleting a saved report removes its schedules too, so both lists refresh. */
export function useDeleteSavedReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => request(deleteSavedReport, { params: { id } }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SAVED_REPORTS_KEY }),
        queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY }),
      ]),
  });
}

function useScheduleMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export const useCreateSchedule = () =>
  useScheduleMutation((body) => request(createReportSchedule, { body }));

export const useUpdateSchedule = () =>
  useScheduleMutation(({ id, body }) =>
    request(updateReportSchedule, { params: { id }, body }),
  );

export const useDeleteSchedule = () =>
  useScheduleMutation((id) =>
    request(deleteReportSchedule, { params: { id } }),
  );

/**
 * Downloads a report (your own scope) under the server's file name: a saved report by id, or a
 * definition through POST /api/reports/export.
 */
export async function downloadReport(
  { savedReportId, definition, title },
  format,
) {
  const { blob, fileName } = savedReportId
    ? await request(exportSavedReport, {
        params: { id: savedReportId },
        query: { format },
      })
    : await request(exportReport, { body: definition, query: { format } });
  const name = fileName === "download" ? `${title}.${format}` : fileName;
  saveBlob(blob, name);
  return name;
}

/** Directory search for people to copy (2 characters or more; the caller debounces). */
export function useRecipientSearch(text) {
  return useQuery({
    queryKey: ["reports", "recipients", text],
    queryFn: () => request(searchReportRecipients, { query: { query: text } }),
    enabled: text.length >= 2,
    staleTime: 60_000,
  });
}
