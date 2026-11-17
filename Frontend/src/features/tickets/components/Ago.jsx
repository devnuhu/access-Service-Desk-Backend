import { formatWat } from "@/shared/lib/time";
import { sinceText } from "../ticketText.js";

/** "5 minutes ago", with the exact WAT time as a tooltip. */
export default function Ago({ at }) {
  return (
    <time dateTime={at} title={formatWat(at)}>
      {sinceText(at)}
    </time>
  );
}
