import { useQuery } from "@tanstack/react-query";
import { sessionQuery } from "../session.js";

/**
 * The signed-in person. status: "loading" | "signedIn" | "signedOut" | "error".
 * @returns {{ user: import("../api/endpoints.js").UserProfile | null, status: string, error: unknown, retry: () => void }}
 */
export default function useSession() {
  const query = useQuery(sessionQuery);
  let status = "loading";
  if (query.data) status = "signedIn";
  else if (query.data === null) status = "signedOut";
  else if (query.isError) status = "error";
  return {
    user: query.data ?? null,
    status,
    error: query.error,
    retry: query.refetch,
  };
}
