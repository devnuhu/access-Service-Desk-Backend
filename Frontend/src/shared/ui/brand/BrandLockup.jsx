import CompanyLogo from "./CompanyLogo.jsx";
import Wordmark from "./Wordmark.jsx";

/** Company logo, a thin divider, then the Access Desk wordmark. */
export default function BrandLockup({ logoHeight = 36, size = "md" }) {
  return (
    <span className="inline-flex items-center gap-4">
      <CompanyLogo height={logoHeight} />
      <span aria-hidden="true" className="h-9 w-px self-center bg-white/30" />
      <Wordmark size={size} />
    </span>
  );
}
