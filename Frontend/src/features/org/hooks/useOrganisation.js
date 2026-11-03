import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import { getMyOrganisation, listOrgDepartments } from "../api/endpoints.js";

export const ORG_ME_KEY = ["org", "me"];
export const ORG_DEPARTMENTS_KEY = ["org", "departments"];

/** My place in the organisation. Fetched after sign-in; refetched when my access changes. */
export function useMyOrganisation({ enabled = true } = {}) {
  return useQuery({
    queryKey: ORG_ME_KEY,
    queryFn: () => request(getMyOrganisation),
    enabled,
  });
}

/** Every active department and unit (names only). */
export function useOrgDepartments({ enabled = true } = {}) {
  return useQuery({
    queryKey: ORG_DEPARTMENTS_KEY,
    queryFn: () => request(listOrgDepartments),
    enabled,
    staleTime: 5 * 60_000,
  });
}
