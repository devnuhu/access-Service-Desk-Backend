import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CATALOGUE_TEMPLATES_KEY } from "@/features/catalogue";
import { request } from "@/shared/lib/http";
import { getCategoryTemplate, saveCategoryTemplate } from "../api/endpoints.js";

const templateKey = (categoryId) => ["category-template", categoryId];

export function useCategoryTemplate(categoryId) {
  return useQuery({
    queryKey: templateKey(categoryId),
    queryFn: () => request(getCategoryTemplate, { params: { categoryId } }),
    enabled: Boolean(categoryId),
  });
}

/** Save (or, with both empty, remove). The raise form's templates are fetched again after. */
export function useSaveCategoryTemplate(categoryId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      request(saveCategoryTemplate, { params: { categoryId }, body }),
    onSuccess: (saved) =>
      queryClient.setQueryData(templateKey(categoryId), saved),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: CATALOGUE_TEMPLATES_KEY }),
  });
}
