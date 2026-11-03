import { PRIORITY, PRIORITY_LABELS } from "../api/endpoints.js";
import { Chip } from "@/shared/ui";

const TONE = {
  [PRIORITY.Low]: "grey",
  [PRIORITY.Medium]: "navy",
  [PRIORITY.High]: "orange",
  [PRIORITY.Critical]: "red",
};

export default function PriorityChip({ priority }) {
  return (
    <Chip tone={TONE[priority] ?? "grey"}>
      {PRIORITY_LABELS[priority] ?? "Unknown"}
    </Chip>
  );
}
