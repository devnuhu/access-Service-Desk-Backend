import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CATALOGUE_KEY, MY_CATEGORIES_KEY } from "@/features/catalogue";
import { request } from "@/shared/lib/http";
import {
  createCategory,
  getUnitSkills,
  listCategories,
  listCoverWarnings,
  setUnitSkills,
  updateCategory,
} from "../api/endpoints.js";

export const catalogueKeys = {
  /** Prefix of every Super Admin category query (lists and cover warnings). */
  all: ["admin", "categories"],
  list: (departmentId) => ["admin", "categories", "list", departmentId],
  coverWarnings: ["admin", "categories", "cover-warnings"],
  /** Prefix of every skills matrix. */
  allSkills: ["admin", "skills"],
  skills: (unitId) => ["admin", "skills", unitId],
};

export function useCategories(departmentId) {
  return useQuery({
    queryKey: catalogueKeys.list(departmentId),
    queryFn: () => request(listCategories, { query: { departmentId } }),
    enabled: Boolean(departmentId),
  });
}

export function useCoverWarnings({ enabled = true } = {}) {
  return useQuery({
    queryKey: catalogueKeys.coverWarnings,
    queryFn: () => request(listCoverWarnings),
    enabled,
  });
}

export function useUnitSkills(unitId, { enabled = true } = {}) {
  return useQuery({
    queryKey: catalogueKeys.skills(unitId),
    queryFn: () => request(getUnitSkills, { params: { unitId } }),
    enabled: Boolean(unitId) && enabled,
  });
}

/**
 * Anything that changes a category or a mapping can change the lists, the cover warnings, the
 * matrices (counts, columns) and what requesters see.
 */
export function refreshCatalogue(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: catalogueKeys.all }),
    queryClient.invalidateQueries({ queryKey: catalogueKeys.allSkills }),
    queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY }),
    queryClient.invalidateQueries({ queryKey: MY_CATEGORIES_KEY }),
  ]);
}

function useCatalogueMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => refreshCatalogue(queryClient),
  });
}

export const useCreateCategory = () =>
  useCatalogueMutation((body) => request(createCategory, { body }));

export const useUpdateCategory = () =>
  useCatalogueMutation(({ categoryId, ...body }) =>
    request(updateCategory, { params: { categoryId }, body }),
  );

/** One PUT; the matrix page sends these one after another and refreshes once at the end. */
export function useSetSkills() {
  return useMutation({
    mutationFn: ({ unitId, userId, categoryIds }) =>
      request(setUnitSkills, {
        params: { unitId, userId },
        body: { categoryIds },
      }),
  });
}
