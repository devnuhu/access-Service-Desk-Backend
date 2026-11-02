/**
 * "Access Desk" with "Service Desk" under it, for navy backgrounds. Platform branding: never a
 * department name here.
 */
export default function Wordmark({ size = "md" }) {
  const large = size === "lg";
  return (
    <span className="inline-flex flex-col leading-none">
      <span
        className={`font-bold tracking-tight text-white ${large ? "text-3xl" : "text-xl"}`}
      >
        Access <span className="text-brand-green">Desk</span>
      </span>
      <span
        className={`mt-1 font-medium tracking-[0.14em] text-white/75 uppercase ${large ? "text-xs" : "text-[10px]"}`}
      >
        Service Desk
      </span>
    </span>
  );
}
