import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  deleteSlaPolicy,
  getSlaPolicies,
  saveSlaPolicy,
} from "../api/endpoints.js";

export const SLA_POLICIES_KEY = ["admin", "sla-policies"];

export function useSlaPolicies() {
  return useQuery({
    queryKey: SLA_POLICIES_KEY,
    queryFn: () => request(getSlaPolicies),
  });
}

function usePolicyMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SLA_POLICIES_KEY }),
  });
}

export const useSaveSlaPolicy = () =>
  usePolicyMutation((body) => request(saveSlaPolicy, { body }));

export const useDeleteSlaPolicy = () =>
  usePolicyMutation((id) => request(deleteSlaPolicy, { params: { id } }));
