import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  listCatalogue,
  listCatalogueTemplates,
  listMyCategories,
} from "../api/endpoints.js";

export const CATALOGUE_KEY = ["catalogue", "categories"];
export const MY_CATEGORIES_KEY = ["catalogue", "mine"];
export const CATALOGUE_TEMPLATES_KEY = ["catalogue", "templates"];

/** The categories a requester can choose, by department (any signed-in person). */
export function useCatalogue({ enabled = true } = {}) {
  return useQuery({
    queryKey: CATALOGUE_KEY,
    queryFn: () => request(listCatalogue),
    enabled,
  });
}

/** The categories I handle, per unit. A pushed "CategorySkills" notification refetches it. */
export function useMyCategories() {
  return useQuery({
    queryKey: MY_CATEGORIES_KEY,
    queryFn: () => request(listMyCategories),
  });
}

/** The raise form's suggested texts, by category (loaded once, kept a few minutes). */
export function useCatalogueTemplates() {
  return useQuery({
    queryKey: CATALOGUE_TEMPLATES_KEY,
    queryFn: () => request(listCatalogueTemplates),
    staleTime: 5 * 60_000,
  });
}
