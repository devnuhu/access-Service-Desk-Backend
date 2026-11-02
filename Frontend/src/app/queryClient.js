import { QueryClient } from "@tanstack/react-query";

const RETRYABLE = new Set(["network", "server"]);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 4xx answers are final (validation, permission, not found); retry only transient failures.
        retry: (failureCount, error) =>
          RETRYABLE.has(error?.kind) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
