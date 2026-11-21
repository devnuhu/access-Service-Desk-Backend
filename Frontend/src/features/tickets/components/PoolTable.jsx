import { Hand } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { Button, Spinner } from "@/shared/ui";
import { formatWat } from "@/shared/lib/time";
import usePickAndOpen from "../hooks/usePickAndOpen.js";
import { sinceText } from "../ticketText.js";

/** "2 hours", "just now": how long a ticket has waited in the pool. */
const waited = (createdAt) => sinceText(createdAt).replace(/ ago$/, "");

/**
 * The unit pool: New tickets nobody holds yet, oldest first. Pick takes one and opens it; the
 * server decides who may (members: their categories; a head: the whole unit). `selected` (a Set of
 * ids) with `onSelect(ticket, on)` and `onSelectAll(on)` adds checkboxes for Pick in bulk.
 */
export default function PoolTable({
  pool,
  showUnit,
  selected,
  onSelect,
  onSelectAll,
}) {
  const { pick, picking } = usePickAndOpen();
  const items = pool.data ?? [];

  if (pool.isLoading) {
    return (
      <div className="px-5 py-10 text-center text-muted">
        <Spinner label="Loading the unit pool…" />
      </div>
    );
  }
  if (pool.isError) {
    return (
      <p role="alert" className="px-5 py-10 text-center text-sm text-danger">
        {pool.error.message}
      </p>
    );
  }
  if (!items.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted">
        Nothing waiting in the pool. New tickets you can take show here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <p className="px-5 pt-4 text-sm text-muted">
        New tickets nobody holds yet, oldest first. Pick one to make it yours.
      </p>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="border-b border-line bg-page/60 text-[11px] font-semibold tracking-wider text-muted uppercase">
          <tr>
            {selected && (
              <th scope="col" className="w-10 py-4 pl-5">
                <input
                  type="checkbox"
                  aria-label="Select every ticket in the pool"
                  checked={items.every((t) => selected.has(t.id))}
                  onChange={(event) => onSelectAll(event.target.checked)}
                  className="h-4 w-4 accent-brand-navy"
                />
              </th>
            )}
            <th scope="col" className="px-5 py-4">
              Reference
            </th>
            {showUnit && (
              <th scope="col" className="px-5 py-4">
                Unit
              </th>
            )}
            <th scope="col" className="px-5 py-4">
              Category
            </th>
            <th scope="col" className="px-5 py-4">
              Priority
            </th>
            <th scope="col" className="px-5 py-4">
              Waiting
            </th>
            <th scope="col" className="px-5 py-4">
              <span className="sr-only">Pick</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((ticket) => (
            <tr key={ticket.id} data-testid={`pool-${ticket.reference}`}>
              {selected && (
                <td className="w-10 py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${ticket.reference}`}
                    checked={selected.has(ticket.id)}
                    onChange={(event) => onSelect(ticket, event.target.checked)}
                    className="h-4 w-4 accent-brand-navy"
                  />
                </td>
              )}
              <td className="px-5 py-3 font-semibold whitespace-nowrap text-brand-navy">
                {ticket.reference}
              </td>
              {showUnit && <td className="px-5 py-3">{ticket.unitName}</td>}
              <td className="px-5 py-3 text-ink">{ticket.categoryName}</td>
              <td className="px-5 py-3">
                <PriorityChip priority={ticket.priority} />
              </td>
              <td className="px-5 py-3 whitespace-nowrap">
                <time
                  dateTime={ticket.createdAt}
                  title={formatWat(ticket.createdAt)}
                >
                  {waited(ticket.createdAt)}
                </time>
              </td>
              <td className="px-5 py-3 text-right">
                <Button
                  size="sm"
                  busy={picking === ticket.id}
                  disabled={Boolean(picking)}
                  onClick={() => pick(ticket)}
                >
                  <Hand aria-hidden="true" size={14} />
                  Pick <span className="sr-only">{ticket.reference}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
