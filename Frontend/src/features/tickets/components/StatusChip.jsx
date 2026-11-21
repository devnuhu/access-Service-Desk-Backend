import { STATUS_STYLE, statusLabel } from "../ticketText.js";

export default function StatusChip({ status }) {
  const [style, dot] = STATUS_STYLE[status] ?? STATUS_STYLE[1];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${style}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {statusLabel(status)}
    </span>
  );
}
