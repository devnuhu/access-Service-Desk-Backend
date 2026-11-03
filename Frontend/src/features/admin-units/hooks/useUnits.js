import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORG_DEPARTMENTS_KEY, ORG_ME_KEY } from "@/features/org";
import { request } from "@/shared/lib/http";
import {
  addUnitMember,
  createDepartment,
  createUnit,
  listAdminDepartments,
  listUnitMembers,
  removeUnitMember,
  setDepartmentHod,
  setUnitDeputy,
  setUnitHead,
  updateDepartment,
  updateUnit,
} from "../api/endpoints.js";

export const unitKeys = {
  departments: ["admin", "departments"],
  members: (unitId) => ["admin", "units", unitId, "members"],
};

export function useAdminDepartments() {
  return useQuery({
    queryKey: unitKeys.departments,
    queryFn: () => request(listAdminDepartments),
  });
}

export function useUnitMembers(unitId) {
  return useQuery({
    queryKey: unitKeys.members(unitId),
    queryFn: () => request(listUnitMembers, { params: { unitId } }),
    enabled: Boolean(unitId),
  });
}

/**
 * After every change: the departments, the unit's members and my own org/me (the change may move
 * the admin in or out of a department, and so change their menu).
 */
function useOrgMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: unitKeys.departments });
      if (variables?.unitId) {
        queryClient.invalidateQueries({
          queryKey: unitKeys.members(variables.unitId),
        });
      }
      queryClient.invalidateQueries({ queryKey: ORG_ME_KEY });
      queryClient.invalidateQueries({ queryKey: ORG_DEPARTMENTS_KEY });
    },
  });
}

export const useCreateDepartment = () =>
  useOrgMutation(({ code, name }) =>
    request(createDepartment, { body: { code, name } }),
  );

export const useUpdateDepartment = () =>
  useOrgMutation(({ departmentId, ...body }) =>
    request(updateDepartment, { params: { departmentId }, body }),
  );

export const useSetHod = () =>
  useOrgMutation(({ departmentId, userId }) =>
    request(setDepartmentHod, { params: { departmentId }, body: { userId } }),
  );

export const useCreateUnit = () =>
  useOrgMutation(({ departmentId, code, name }) =>
    request(createUnit, { params: { departmentId }, body: { code, name } }),
  );

export const useUpdateUnit = () =>
  useOrgMutation(({ unitId, ...body }) =>
    request(updateUnit, { params: { unitId }, body }),
  );

export const useSetHead = () =>
  useOrgMutation(({ unitId, userId }) =>
    request(setUnitHead, { params: { unitId }, body: { userId } }),
  );

export const useSetDeputy = () =>
  useOrgMutation(({ unitId, userId }) =>
    request(setUnitDeputy, { params: { unitId }, body: { userId } }),
  );

export const useAddMember = () =>
  useOrgMutation(({ unitId, userId, staffNo }) =>
    request(addUnitMember, {
      params: { unitId },
      body: { userId, ...(staffNo ? { staffNo } : {}) },
    }),
  );

export const useRemoveMember = () =>
  useOrgMutation(({ unitId, userId }) =>
    request(removeUnitMember, { params: { unitId, userId } }),
  );
