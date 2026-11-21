import { Mail, Play } from "lucide-react";
import { Button, Spinner } from "@/shared/ui";

/** The ready-made reports from GET /api/reports/catalogue (builtIn), as cards. */
export default function ReadyMadeReports({ catalogue, onRun, onSaveAndEmail }) {
  const builtIn = catalogue.data?.builtIn ?? [];

  return (
    <section aria-labelledby="ready-made-heading" className="px-5 py-4">
      <h2 id="ready-made-heading" className="text-base font-semibold">
        Ready-made reports
      </h2>
      <p className="mt-0.5 text-sm text-muted">
        Run one as it is, change the dates, or save it as your own.
      </p>
      {catalogue.isLoading ? (
        <div className="py-6 text-center text-muted">
          <Spinner label="Loading ready-made reports…" />
        </div>
      ) : catalogue.isError ? (
        <p role="alert" className="py-6 text-sm text-danger">
          {catalogue.error.message}
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {builtIn.map((report) => (
            <li
              key={report.code}
              data-testid={`builtin-${report.code}`}
              className="flex flex-col rounded-card border border-line p-4"
            >
              <p className="font-semibold text-ink">{report.name}</p>
              <p className="mt-1 flex-1 text-sm text-body">
                {report.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onRun(report)}>
                  <Play aria-hidden="true" size={14} />
                  Run <span className="sr-only">{report.name}</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onSaveAndEmail(report)}
                >
                  <Mail aria-hidden="true" size={14} />
                  Save and email me this
                  <span className="sr-only"> {report.name}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
