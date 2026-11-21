import { PageHeader } from "@/shared/ui";
import ReplyLibrary from "../components/ReplyLibrary.jsx";

/** Administration > Shared replies (Super Admin): replies every unit can use on its tickets. */
export default function SharedRepliesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Shared replies"
        description="Saved replies every unit can use. On a ticket they come after the unit's own replies, marked Shared."
      />
      <ReplyLibrary
        title="Replies"
        description="Placeholders such as {{requester.name}} are filled in for each ticket."
      />
    </div>
  );
}
