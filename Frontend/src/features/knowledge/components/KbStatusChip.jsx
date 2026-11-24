import { Chip } from "@/shared/ui";
import { KB_STATUS } from "../api/endpoints.js";

export default function KbStatusChip({ status }) {
  return (
    <Chip tone={status === KB_STATUS.Published ? "green" : "orange"}>
      {status === KB_STATUS.Published ? "Published" : "Draft"}
    </Chip>
  );
}
