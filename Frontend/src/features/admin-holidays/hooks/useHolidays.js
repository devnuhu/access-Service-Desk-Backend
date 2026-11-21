import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
} from "../api/endpoints.js";

export const HOLIDAYS_KEY = ["admin", "holidays"];

export function useHolidays(year) {
  return useQuery({
    queryKey: [...HOLIDAYS_KEY, year],
    queryFn: () => request(listHolidays, { query: { year } }),
  });
}

/** Any change refreshes every year's list (and the deadlines shown elsewhere follow on their own refresh). */
function useHolidayMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: HOLIDAYS_KEY }),
  });
}

export const useCreateHoliday = () =>
  useHolidayMutation((body) => request(createHoliday, { body }));

export const useDeleteHoliday = () =>
  useHolidayMutation((holidayId) =>
    request(deleteHoliday, { params: { holidayId } }),
  );
