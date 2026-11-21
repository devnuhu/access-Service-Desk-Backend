import { useState } from "react";
import { MessageSquareText, Plus } from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Spinner,
  useToast,
} from "@/shared/ui";
import { useDeleteReply, useReplyLibrary } from "../hooks/useCannedReplies.js";
import ReplyEditorDialog from "./ReplyEditorDialog.jsx";

function preview(html) {
  const doc = new DOMParser().parseFromString(html ?? "", "text/html");
  return doc.body.textContent ?? "";
}

/**
 * A library of saved replies: a unit's (unitId) or the shared one (no unitId). Add, edit, remove
 * (after a confirm). `description` says whose library it is.
 */
export default function ReplyLibrary({ unitId, title, description }) {
  const toast = useToast();
  const library = useReplyLibrary(unitId);
  const remove = useDeleteReply();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const list = library.data ?? [];

  const saved = (reply, changed) => {
    setEditing(null);
    toast.success(
      changed ? "Your changes are saved." : "It is ready to use on tickets.",
      {
        title: changed ? reply.title : `${reply.title} added`,
      },
    );
  };

  const confirmRemove = async () => {
    try {
      const result = await remove.mutateAsync(removing.id);
      toast.success(result.message, { title: `${removing.title} removed` });
    } catch (error) {
      toast.error(error.message, { title: `${removing.title} not removed` });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus aria-hidden="true" size={16} />
            Add reply
          </Button>
        }
      />
      {library.isLoading ? (
        <div className="px-5 py-10 text-center text-muted">
          <Spinner label="Loading replies…" />
        </div>
      ) : library.isError ? (
        <p role="alert" className="px-5 py-10 text-center text-sm text-danger">
          {library.error.message}
        </p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <MessageSquareText
            aria-hidden="true"
            size={28}
            className="text-muted"
          />
          <p className="font-semibold text-ink">No saved replies yet</p>
          <p className="max-w-md text-sm text-muted">
            Save the answers your team writes again and again. Case workers pick
            them from “Replies” on a ticket and edit before sending.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((reply) => (
            <li
              key={reply.id}
              data-testid={`reply-${reply.title}`}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{reply.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-body">
                  {preview(reply.bodyHtml)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {reply.updatedAt
                    ? `Changed ${formatWat(reply.updatedAt)}`
                    : `Added ${formatWat(reply.createdAt)}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing({ reply })}
                >
                  Edit <span className="sr-only">{reply.title}</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRemoving(reply)}
                >
                  Remove <span className="sr-only">{reply.title}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ReplyEditorDialog
          unitId={unitId}
          reply={editing.reply}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.title ?? ""}?`}
        message="Nobody can use it on tickets any more. Replies already sent stay as they are."
        confirmLabel="Remove"
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
