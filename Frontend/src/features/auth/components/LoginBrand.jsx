import { Check, Clock, Plus } from "lucide-react";
import { CompanyLogo } from "@/shared/ui";
import ServiceDeskIllustration from "./ServiceDeskIllustration.jsx";

const POINTS = [
  {
    icon: Plus,
    color: "text-brand-orange",
    lines: ["Raise a request", "in a minute"],
  },
  {
    icon: Clock,
    color: "text-brand-orange",
    lines: ["Clear response", "and resolution times"],
  },
  {
    icon: Check,
    color: "text-brand-navy",
    lines: ["Updates by email", "and in the app"],
  },
];

/** Company logo, divider, then "Access Desk" with "Service Desk" under it (light background). */
function LogoRow() {
  return (
    <div className="flex items-center gap-4">
      <CompanyLogo height={32} className="border border-login-badge-line" />
      <span aria-hidden="true" className="h-10 w-px bg-login-divider" />
      <span className="flex flex-col leading-none whitespace-nowrap">
        <span className="text-[22px] font-bold tracking-tight text-brand-navy lg:text-2xl">
          Access <span className="text-brand-green">Desk</span>
        </span>
        <span className="mt-1 text-xs font-medium text-login-unit">
          Service Desk
        </span>
      </span>
    </div>
  );
}

/** Green / orange / navy band along the bottom edge (desktop only). */
function BrandBand() {
  return (
    <div aria-hidden="true" className="hidden h-1.5 lg:flex">
      <span className="flex-[5] bg-brand-green" />
      <span className="flex-[2] bg-brand-orange" />
      <span className="flex-[3] bg-brand-navy" />
    </div>
  );
}

/**
 * The light brand panel. Desktop (1024px and wider): logo row, illustration, headline, text, three
 * points and the legal line, in one flex column. Under 1024px: only a short band with the logo row.
 */
export function LoginBrandPanel() {
  return (
    <aside className="flex flex-col bg-login-brand">
      <div className="flex flex-1 flex-col px-6 pt-6 pb-[44px] lg:px-14 lg:pt-12 lg:pb-10">
        <LogoRow />

        <div className="hidden flex-1 items-center justify-center py-8 lg:flex">
          <ServiceDeskIllustration className="h-auto w-full max-w-[360px] xl:max-w-[440px]" />
        </div>

        <div className="hidden lg:block">
          <h2 className="max-w-md text-[32px] leading-tight font-bold text-brand-navy">
            Every request, to the right team, on time.
          </h2>
          <p className="mt-3 max-w-lg text-base text-body">
            Raise a request to any department, follow it to resolution, and see
            who is working on it, all in one place.
          </p>
          <ul className="mt-6 flex flex-col gap-3 xl:flex-row xl:gap-6">
            {POINTS.map(({ icon: Icon, color, lines }) => (
              <li
                key={lines[0]}
                className="flex items-center gap-2.5 text-sm text-ink"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-login-icon-line bg-white">
                  <Icon aria-hidden="true" size={16} className={color} />
                </span>
                <span className="leading-snug">
                  {lines[0]}
                  <br />
                  {lines[1]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-login-legal">
            Access ARM Pensions Plc · For staff use only
          </p>
        </div>
      </div>
      <BrandBand />
    </aside>
  );
}
