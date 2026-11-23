import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  getMyPerformance,
  getPersonPerformance,
  getUnitPerformance,
} from "../api/endpoints.js";
import { periodQuery, readPeriod, storePeriod } from "../period.js";

// A period change keeps the last figures on screen until the new ones arrive.
const KEEP = { staleTime: 60_000, placeholderData: keepPreviousData };

/** The chosen period, kept in this browser tab while navigating. */
export function usePeriod() {
  const [period, setPeriod] = useState(readPeriod);
  const choose = (next) => {
    setPeriod(next);
    storePeriod(next);
  };
  return [period, choose];
}

/** Custom dates wait for both dates before asking. */
const ready = (period) =>
  period.preset !== "custom" || Boolean(period.from && period.to);

export function useMyPerformance(period) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ["performance", "me", query],
    queryFn: () => request(getMyPerformance, { query }),
    enabled: ready(period),
    ...KEEP,
  });
}

export function usePersonPerformance(userId, period) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ["performance", "person", userId, query],
    queryFn: () => request(getPersonPerformance, { params: { userId }, query }),
    enabled: Boolean(userId) && ready(period),
    ...KEEP,
  });
}

export function useUnitPerformance(unitId, period) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ["performance", "unit", unitId, query],
    queryFn: () => request(getUnitPerformance, { params: { unitId }, query }),
    enabled: Boolean(unitId) && ready(period),
    ...KEEP,
  });
}
