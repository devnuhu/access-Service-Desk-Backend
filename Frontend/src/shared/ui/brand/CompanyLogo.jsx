import { logoUrl } from "./logo.js";

/**
 * The Access Pensions logo. On navy, a full-colour logo sits on a white badge (badge); a white
 * version of the logo sits directly on the navy (badge={false}).
 */
export default function CompanyLogo({
  height = 36,
  badge = true,
  className = "",
}) {
  const image = (
    <img
      src={logoUrl}
      alt="Access Pensions"
      style={{ height }}
      className="block w-auto"
    />
  );
  return badge ? (
    <span className={`logo-badge ${className}`}>{image}</span>
  ) : (
    <span className={className}>{image}</span>
  );
}
