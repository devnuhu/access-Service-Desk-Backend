import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarOff,
  FileBarChart2,
  Hourglass,
  Mail,
  RotateCcw,
  ShieldCheck,
  Tags,
  Timer,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Spinner } from "@/shared/ui";

/**
 * An icon and a tint for a report, read from its name. Only the look: the reports themselves always
 * come from the catalogue, and a name that matches nothing gets the plain report icon.
 */
const LOOKS = [
  [/breach/i, TriangleAlert, "bg-danger-light text-danger"],
  [/sla|compliance/i, ShieldCheck, "bg-brand-green-light text-brand-green-ink"],
  [/response/i, Timer, "bg-brand-orange-light text-brand-orange-ink"],
  [/age/i, Hourglass, "bg-brand-orange-light text-brand-orange-ink"],
  [/escalat|reopen/i, RotateCcw, "bg-danger-light text-danger"],
  [/leave|cover/i, CalendarOff, "bg-brand-navy-light text-brand-navy"],
  [/unit/i, Building2, "bg-brand-navy-light text-brand-navy"],
  [/team|workload|person/i, Users, "bg-brand-navy-light text-brand-navy"],
  [/categor/i, Tags, "bg-brand-green-light text-brand-green-ink"],
  [/raised|resolved|volume/i, BarChart3, "bg-brand-navy-light text-brand-navy"],
];
const lookFor = (name) =>
  LOOKS.find(([pattern]) => pattern.test(name)) ?? [
    null,
    FileBarChart2,
    "bg-brand-navy-light text-brand-navy",
  ];

/** The ready-made reports from GET /api/reports/catalogue (builtIn), as cards. */
export default function ReadyMadeReports({ catalogue, onRun, onSaveAndEmail }) {
  const builtIn = catalogue.data?.builtIn ?? [];

  return (
    <section aria-labelledby="ready-made-heading" className="px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ready-made-heading" className="text-base font-semibold">
            Ready-made reports
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Run one as it is, change the dates, or save it as your own.
          </p>
        </div>
        {builtIn.length > 0 && (
          <span className="text-xs text-muted">
            {builtIn.length} {builtIn.length === 1 ? "report" : "reports"}
          </span>
        )}
      </div>
      {catalogue.isLoading ? (
        <div className="py-6 text-center text-muted">
          <Spinner label="Loading ready-made reports…" />
        </div>
      ) : catalogue.isError ? (
        <p role="alert" className="py-6 text-sm text-danger">
          {catalogue.error.message}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {builtIn.map((report) => {
            const [, Icon, tint] = lookFor(report.name);
            return (
              <li
                key={report.code}
                data-testid={`builtin-${report.code}`}
                className="group flex flex-col rounded-xl border border-line bg-white shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-brand-navy/30 hover:shadow-md"
              >
                <div className="flex flex-1 gap-3.5 p-5">
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}
                  >
                    <Icon size={19} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] leading-snug font-semibold text-ink">
                      {report.name}
                    </h3>
                    <p
                      className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted"
                      title={report.description}
                    >
                      {report.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
                  <button
                    type="button"
                    onClick={() => onSaveAndEmail(report)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-page hover:text-brand-navy"
                  >
                    <Mail aria-hidden="true" size={14} />
                    Save and email{" "}
                    <span className="sr-only">me this: {report.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRun(report)}
                    aria-label={`Run ${report.name}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
                  >
                    Run report
                    <ArrowRight
                      aria-hidden="true"
                      size={15}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
