import CompanyLogo from "./CompanyLogo.jsx";
import Wordmark from "./Wordmark.jsx";

/** Company logo, a thin divider, then the Access Service Desk wordmark (tone: "light" on navy, "dark" on white). */
export default function BrandLockup({
  logoHeight = 36,
  size = "md",
  tone = "light",
}) {
  return (
    <span className="inline-flex items-center gap-4">
      <CompanyLogo height={logoHeight} badge={tone !== "dark"} />
      <span
        aria-hidden="true"
        className={`h-9 w-px self-center ${tone === "dark" ? "bg-line" : "bg-white/30"}`}
      />
      <Wordmark size={size} tone={tone} />
    </span>
  );
}
