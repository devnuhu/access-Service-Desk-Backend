import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import { listCatalogue } from "../api/endpoints.js";

export const CATALOGUE_KEY = ["catalogue", "categories"];

/** The categories a requester can choose, by department (any signed-in person). */
export function useCatalogue({ enabled = true } = {}) {
  return useQuery({
    queryKey: CATALOGUE_KEY,
    queryFn: () => request(listCatalogue),
    enabled,
  });
}
