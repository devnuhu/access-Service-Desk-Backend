import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { signOut } from "../session.js";

/** Signs out and goes to the sign-in page, replacing history so Back does not show private pages. */
export default function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await signOut(queryClient);
    } catch {
      // The session is cleared locally whatever the API answered.
    }
    navigate("/login", { replace: true });
  }, [queryClient, navigate]);
}
