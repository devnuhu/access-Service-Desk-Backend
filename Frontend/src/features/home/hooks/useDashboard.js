import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import { getDashboardSummary, getUnitDashboard } from "../api/endpoints.js";

export const DASHBOARD_KEY = ["dashboard", "summary"];
const TWO_MINUTES = 2 * 60_000;

/** Refreshed every 2 minutes while the page is open and when the tab gets focus. */
const LIVE = {
  refetchInterval: TWO_MINUTES,
  refetchOnWindowFocus: "always",
  staleTime: 30_000,
};

/**
 * The home counts. A refresh keeps the counts on screen (isLoading is only the first load).
 */
export function useDashboardSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => request(getDashboardSummary),
    enabled,
    ...LIVE,
  });
}

/** One unit's dashboard (a 403 or 404 is final, like every 4xx). */
export function useUnitDashboard(unitId) {
  return useQuery({
    queryKey: ["dashboard", "unit", unitId],
    queryFn: () => request(getUnitDashboard, { params: { unitId } }),
    enabled: Boolean(unitId),
    ...LIVE,
  });
}
