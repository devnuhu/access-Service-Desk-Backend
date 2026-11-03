import { STATUS_STYLE, statusLabel } from "../ticketText.js";

export default function StatusChip({ status }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase ${STATUS_STYLE[status] ?? STATUS_STYLE[1]}`}
    >
      {statusLabel(status)}
    </span>
  );
}
