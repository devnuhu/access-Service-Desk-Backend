import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  createLocation,
  listAdminLocations,
  updateLocation,
} from "../api/endpoints.js";

export const LOCATIONS_KEY = ["admin", "locations"];
/** The choices on the ticket form (GET /api/locations) follow any change. */
const TICKET_LOCATIONS_KEY = ["tickets", "locations"];

export function useAdminLocations() {
  return useQuery({
    queryKey: LOCATIONS_KEY,
    queryFn: () => request(listAdminLocations),
  });
}

function useLocationMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: TICKET_LOCATIONS_KEY }),
      ]),
  });
}

export const useCreateLocation = () =>
  useLocationMutation((body) => request(createLocation, { body }));

export const useUpdateLocation = () =>
  useLocationMutation(({ locationId, ...body }) =>
    request(updateLocation, { params: { locationId }, body }),
  );
