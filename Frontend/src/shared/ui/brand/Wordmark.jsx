/**
 * "Access Service Desk": a small spaced ACCESS over a bold "Service Desk" (Desk in green).
 * tone="light" for navy backgrounds (white), tone="dark" for white ones (navy). Platform
 * branding: never a department name here.
 */
export default function Wordmark({ size = "md", tone = "light" }) {
  const large = size === "lg";
  const dark = tone === "dark";
  return (
    <span className="inline-flex flex-col leading-none whitespace-nowrap">
      <span
        className={`font-semibold tracking-[0.32em] uppercase ${dark ? "text-muted" : "text-white/70"} ${large ? "text-xs" : "text-[10px]"}`}
      >
        Access
      </span>
      <span
        className={`mt-1 font-bold tracking-tight ${dark ? "text-brand-navy" : "text-white"} ${large ? "text-3xl" : "text-xl"}`}
      >
        Service{" "}
        <span className={dark ? "text-brand-green-text" : "text-brand-green"}>
          Desk
        </span>
      </span>
    </span>
  );
}
