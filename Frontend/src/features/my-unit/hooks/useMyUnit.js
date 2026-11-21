import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  getUnitSkills,
  listUnitCategories,
  listUnitTeam,
  setMemberSkills,
} from "../api/endpoints.js";

export const myUnitKeys = {
  all: (unitId) => ["my-unit", unitId],
  categories: (unitId) => ["my-unit", unitId, "categories"],
  team: (unitId) => ["my-unit", unitId, "team"],
  skills: (unitId) => ["my-unit", unitId, "skills"],
};

export const useUnitCategories = (unitId) =>
  useQuery({
    queryKey: myUnitKeys.categories(unitId),
    queryFn: () => request(listUnitCategories, { params: { unitId } }),
  });

export const useUnitTeam = (unitId) =>
  useQuery({
    queryKey: myUnitKeys.team(unitId),
    queryFn: () => request(listUnitTeam, { params: { unitId } }),
  });

export const useMyUnitSkills = (unitId) =>
  useQuery({
    queryKey: myUnitKeys.skills(unitId),
    queryFn: () => request(getUnitSkills, { params: { unitId } }),
  });

/**
 * Saves one member's whole set at once. Optimistic: the matrix shows the new set straight away
 * and goes back to what it was if the server refuses. Afterwards the unit's lists and its
 * dashboard are fetched again (counts and cover change).
 */
export function useSaveMemberSkills(unitId) {
  const queryClient = useQueryClient();
  const key = myUnitKeys.skills(unitId);
  return useMutation({
    mutationFn: ({ userId, categoryIds }) =>
      request(setMemberSkills, {
        params: { unitId, userId },
        body: { categoryIds },
      }),
    onMutate: async ({ userId, categoryIds }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (data) =>
        data
          ? {
              ...data,
              members: data.members.map((m) =>
                m.userId === userId ? { ...m, categoryIds } : m,
              ),
            }
          : data,
      );
      return { before };
    },
    onError: (_error, _vars, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myUnitKeys.all(unitId) }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "unit", unitId],
        }),
      ]),
  });
}
