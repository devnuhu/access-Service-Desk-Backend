import { LoaderCircle } from "lucide-react";

export default function Spinner({ size = 20, label, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role={label ? "status" : undefined}
    >
      <LoaderCircle
        aria-hidden="true"
        className="animate-spin"
        style={{ width: size, height: size }}
      />
      {label && <span>{label}</span>}
    </span>
  );
}
