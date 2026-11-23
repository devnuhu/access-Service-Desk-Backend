import { Spinner } from "@/shared/ui";
import { useMyPerformance, usePeriod } from "../hooks/usePerformance.js";
import PeriodPicker from "./PeriodPicker.jsx";
import PersonPerformance from "./PersonPerformance.jsx";

/**
 * "My performance" on a case worker's dashboard: their own figures only (GET /api/performance/me),
 * for the chosen period (kept while navigating).
 */
export default function MyPerformancePanel() {
  const [period, setPeriod] = usePeriod();
  const query = useMyPerformance(period);
  return (
    <section
      aria-labelledby="my-performance"
      data-testid="my-performance"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="my-performance" className="text-base font-semibold">
          My performance
        </h2>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {query.isLoading ? (
        <div className="py-8 text-center text-muted">
          <Spinner label="Loading your figures…" />
        </div>
      ) : query.isError && !query.data ? (
        <p role="alert" className="text-sm text-danger">
          {query.error.message}
        </p>
      ) : query.data ? (
        <div
          className={query.isFetching ? "opacity-70 transition-opacity" : ""}
        >
          {query.isError && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {query.error.message}
            </p>
          )}
          <PersonPerformance data={query.data} />
        </div>
      ) : (
        <p className="text-sm text-muted">Choose both dates.</p>
      )}
    </section>
  );
}
