import { CircleHelp, TriangleAlert } from "lucide-react";
import Button from "./Button.jsx";
import Dialog from "./Dialog.jsx";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? "bg-danger-light text-danger" : "bg-brand-navy-light text-brand-navy"}`}
        >
          {danger ? <TriangleAlert size={19} /> : <CircleHelp size={19} />}
        </span>
        <p className="pt-2 text-sm leading-relaxed text-body">{message}</p>
      </div>
    </Dialog>
  );
}
