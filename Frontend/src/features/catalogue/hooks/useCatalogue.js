import { useQuery } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  getCatalogueSuggestions,
  getPriorityMatrix,
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

export const PRIORITY_MATRIX_KEY = ["catalogue", "priority-matrix"];

/** The impact and urgency questions and the matrix (loaded once, kept a few minutes). */
export function usePriorityMatrix() {
  return useQuery({
    queryKey: PRIORITY_MATRIX_KEY,
    queryFn: () => request(getPriorityMatrix),
    staleTime: 5 * 60_000,
  });
}

export const CATALOGUE_SUGGESTIONS_KEY = ["catalogue", "suggestions"];

/** Recent and popular request types for the quick picks (kept a few minutes). */
export function useCatalogueSuggestions() {
  return useQuery({
    queryKey: CATALOGUE_SUGGESTIONS_KEY,
    queryFn: () => request(getCatalogueSuggestions),
    staleTime: 5 * 60_000,
  });
}
