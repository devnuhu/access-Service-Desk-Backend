import { Navigate, Outlet, useLocation } from "react-router-dom";
import { CloudOff } from "lucide-react";
import { Button, MessageCard, Spinner } from "@/shared/ui";
import { hasAnyRole } from "@/shared/lib/roles";
import useSession from "../hooks/useSession.js";

/**
 * Route guard. Not signed in -> /login?next=<this page>. Signed in without one of `roles` ->
 * /no-access. No `roles` means any signed-in person. The server still decides access (rule 2):
 * hiding is only for the user.
 */
export default function RequireRole({ roles, children }) {
  const { user, status, error, retry } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <MessageCard
        icon={CloudOff}
        title="Access Service Desk cannot be reached"
        linkTo={null}
      >
        <p>{error?.message ?? "Try again shortly."}</p>
        <Button className="mt-4" variant="secondary" onClick={() => retry()}>
          Try again
        </Button>
      </MessageCard>
    );
  }
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (roles?.length && !hasAnyRole(user, roles)) {
    return <Navigate to="/no-access" replace />;
  }
  return children ?? <Outlet />;
}
