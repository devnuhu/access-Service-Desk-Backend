import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import { LIST_PAGE_SIZE } from "@/shared/lib/paging";
import {
  assignRole,
  ensureDirectoryUser,
  getUser,
  listRoles,
  listUsers,
  removeRole,
  searchDirectory,
  setUserStatus,
} from "../api/endpoints.js";

export const peopleKeys = {
  all: ["admin-people"],
  list: (filters) => ["admin-people", "list", filters],
  person: (id) => ["admin-people", "person", id],
  roles: ["admin-people", "roles"],
  directory: (query) => ["admin-people", "directory", query],
};

/** People matching a search, for pickers (the first 10). */
export async function searchPeople(search) {
  const result = await request(listUsers, {
    query: { page: 1, pageSize: 10, search },
  });
  return result.items;
}

export function usePeopleList({ page, search, role }) {
  return useQuery({
    queryKey: peopleKeys.list({ page, search, role }),
    queryFn: () =>
      request(listUsers, {
        query: { page, pageSize: LIST_PAGE_SIZE, search, role },
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePerson(userId) {
  return useQuery({
    queryKey: peopleKeys.person(userId),
    queryFn: () => request(getUser, { params: { userId } }),
    enabled: Boolean(userId),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: peopleKeys.roles,
    queryFn: () => request(listRoles),
    staleTime: 5 * 60_000,
  });
}

export function useDirectorySearch(query) {
  return useQuery({
    queryKey: peopleKeys.directory(query),
    queryFn: () => request(searchDirectory, { query: { query } }),
    enabled: Boolean(query),
    retry: false,
  });
}

/** Every change refreshes the list and the open person. */
function usePeopleMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: peopleKeys.all }),
  });
}

export function useAssignRole() {
  return usePeopleMutation(({ userId, roleId }) =>
    request(assignRole, { params: { userId }, body: { roleId } }),
  );
}

export function useRemoveRole() {
  return usePeopleMutation(({ userId, roleId }) =>
    request(removeRole, { params: { userId, roleId } }),
  );
}

export function useSetStatus() {
  return usePeopleMutation(({ userId, isActive }) =>
    request(setUserStatus, { params: { userId }, body: { isActive } }),
  );
}

export function useEnsureDirectoryUser() {
  return usePeopleMutation((samAccountName) =>
    request(ensureDirectoryUser, { body: { samAccountName } }),
  );
}
