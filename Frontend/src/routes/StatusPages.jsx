import { Compass, ShieldOff } from "lucide-react";
import { MessageCard } from "@/shared/ui";

export function NoAccessPage() {
  return (
    <MessageCard icon={ShieldOff} title="You do not have access to this page">
      <p>
        Your roles do not include this area. If you think you need it, ask a
        Super Admin.
      </p>
    </MessageCard>
  );
}

export function NotFoundPage() {
  return (
    <MessageCard icon={Compass} title="Page not found">
      <p>This page does not exist, or it has moved.</p>
    </MessageCard>
  );
}
