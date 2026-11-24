import { Check, Clock, Plus } from "lucide-react";
import { BRAND } from "@/shared/brand";
import { BrandLockup, CompanyLogo } from "@/shared/ui";
import ServiceDeskIllustration from "./ServiceDeskIllustration.jsx";

const POINTS = [
  {
    icon: Plus,
    color: "text-desk-orange",
    lines: ["Raise a request", "in a minute"],
  },
  {
    icon: Clock,
    color: "text-desk-orange",
    lines: ["Clear response", "and resolution times"],
  },
  {
    icon: Check,
    color: "text-desk-green",
    lines: ["Updates by email", "and in the app"],
  },
];

/** The company logo, beside the lockup. */
function ByCompany() {
  return <CompanyLogo height={28} badge={false} className="shrink-0" />;
}

/** Green / orange / navy band along the bottom edge (desktop only). */
function BrandBand() {
  return (
    <div aria-hidden="true" className="hidden h-1.5 shrink-0 lg:flex">
      <span className="flex-[5] bg-desk-green" />
      <span className="flex-[2] bg-desk-orange" />
      <span className="flex-[3] bg-desk-navy" />
    </div>
  );
}

/**
 * The light brand panel.
 *
 * Desktop (1024px and wider), as tall as the window, in three bands: the Access Desk lockup with the
 * Access Pensions logo across the top and the caption and descriptor under it; in the middle the
 * illustration (it shrinks with the window's height and goes on short screens), the headline, a
 * line of text and three points; along the bottom the copyright line. The content keeps a readable width on very
 * wide screens.
 *
 * Phones and tablets: a compact header with the lockup, the company, the caption and the
 * descriptor; the form panel overlaps its bottom edge.
 */
export function LoginBrandPanel() {
  return (
    <aside
      data-testid="login-brand"
      className="flex flex-col bg-login-brand lg:sticky lg:top-0 lg:h-screen"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-6 pb-10 sm:px-10 sm:pt-8 lg:min-h-0 lg:px-14 lg:pt-10 lg:pb-8 xl:px-16 2xl:max-w-3xl">
        {/* Top: the product, and the company. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <BrandLockup size="lg" />
          <ByCompany />
        </div>

        {/* The caption, and (small) the name it replaces, under the lockup at every size. */}
        <div className="mt-3 lg:mt-4">
          <p className="text-sm font-semibold text-desk-navy lg:text-base">
            {BRAND.caption}
          </p>
          <p className="mt-0.5 text-xs text-login-unit">{BRAND.descriptor}</p>
        </div>

        {/* Desktop: the story, centred in the space left. */}
        <div className="hidden min-h-0 flex-1 flex-col justify-center py-8 lg:flex">
          <div className="flex min-h-0 justify-center [@media(max-height:46rem)]:hidden">
            <ServiceDeskIllustration className="h-auto max-h-[34vh] w-full max-w-[400px] xl:max-w-[440px] 2xl:max-h-[38vh] 2xl:max-w-[560px]" />
          </div>

          <div className="mt-8 [@media(max-height:46rem)]:mt-0">
            <h2 className="max-w-xl text-3xl leading-tight font-bold tracking-tight text-desk-navy xl:text-4xl 2xl:text-[2.6rem]">
              Every request, to the right team, on time.
            </h2>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-body">
              Raise a request to any department, follow it to resolution, and
              see who is working on it, all in one place.
            </p>
            <ul className="mt-7 grid grid-cols-3 gap-3">
              {POINTS.map(({ icon: Icon, color, lines }) => (
                <li
                  key={lines[0]}
                  className="flex flex-col gap-2.5 rounded-xl border border-login-icon-line bg-white/70 p-3.5 text-sm 2xl:flex-row 2xl:items-center"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-login-icon-line">
                    <Icon aria-hidden="true" size={16} className={color} />
                  </span>
                  <span className="flex flex-col leading-snug">
                    <span className="font-semibold text-ink">{lines[0]}</span>
                    <span className="text-body">{lines[1]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom (desktop): the copyright. Phones and tablets show it under the form. */}
        <p className="hidden border-t border-login-divider/60 pt-4 text-xs text-login-legal lg:block">
          © {new Date().getFullYear()} {BRAND.legalName}
        </p>
      </div>
      <BrandBand />
    </aside>
  );
}
