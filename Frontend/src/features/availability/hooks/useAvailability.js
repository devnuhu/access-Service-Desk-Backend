import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  cancelAbsence,
  createAbsence,
  getDepartmentAvailability,
  getMyAvailability,
  getUnitAvailability,
} from "../api/endpoints.js";

/** Every availability query starts with "availability", so one invalidation refreshes them all. */
export const availabilityKeys = {
  all: ["availability"],
  me: ["availability", "me"],
  unit: (unitId) => ["availability", "unit", unitId],
  department: (departmentId) => ["availability", "department", departmentId],
};

export function useMyAvailability() {
  return useQuery({
    queryKey: availabilityKeys.me,
    queryFn: () => request(getMyAvailability),
  });
}

export function useUnitAvailability(unitId) {
  return useQuery({
    queryKey: availabilityKeys.unit(unitId),
    queryFn: () => request(getUnitAvailability, { params: { unitId } }),
  });
}

export function useDepartmentAvailability(departmentId) {
  return useQuery({
    queryKey: availabilityKeys.department(departmentId),
    queryFn: () =>
      request(getDepartmentAvailability, { params: { departmentId } }),
  });
}

function useAvailabilityMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
  });
}

/** Records leave or out of office. Leave userId out for yourself. */
export const useRecordAbsence = () =>
  useAvailabilityMutation((body) => request(createAbsence, { body }));

/** Cancels a future period, or ends a started one early. */
export const useCancelAbsence = () =>
  useAvailabilityMutation((absenceId) =>
    request(cancelAbsence, { params: { absenceId } }),
  );
