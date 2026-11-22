import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PRIORITY_MATRIX_KEY } from "@/features/catalogue";
import { request } from "@/shared/lib/http";
import { savePriorityMatrix } from "../api/endpoints.js";

/** Save changed cells; the answer (the whole matrix) replaces the cached one. */
export function useSavePriorityMatrix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cells) => request(savePriorityMatrix, { body: { cells } }),
    onSuccess: (matrix) =>
      queryClient.setQueryData(PRIORITY_MATRIX_KEY, matrix),
  });
}
