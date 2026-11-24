import { BRAND } from "@/shared/brand";
import BrandMark from "./BrandMark.jsx";

const SIZES = {
  sm: { mark: 26, text: "text-xl" },
  md: { mark: 32, text: "text-2xl" },
  lg: { mark: 44, text: "text-[2.1rem]" },
};

/**
 * The Access Desk lockup: the mark and the wordmark "Access Desk", written as the name is. tone "dark" sits on light backgrounds (navy word, colour mark); "light" on dark.
 * The lockup carries the accessible name once.
 */
export default function BrandLockup({ size = "md", tone = "dark" }) {
  const s = SIZES[size] ?? SIZES.md;
  const onDark = tone === "light";
  return (
    <span
      role="img"
      aria-label={BRAND.name}
      className="inline-flex items-center gap-2.5"
    >
      <BrandMark
        size={s.mark}
        variant={onDark ? "light" : "color"}
        decorative
      />
      <span
        aria-hidden="true"
        className={`font-brand leading-none font-extrabold whitespace-nowrap tracking-[-0.03em] ${s.text} ${onDark ? "text-white" : "text-desk-navy"}`}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
