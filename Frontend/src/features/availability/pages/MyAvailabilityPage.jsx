import { CalendarCheck, CalendarX } from "lucide-react";
import { WhatIHandle } from "@/features/catalogue";
import { Card, CardHeader, Spinner, PageHeader } from "@/shared/ui";
import { awayUntil } from "../absenceText.js";
import AbsenceForm from "../components/AbsenceForm.jsx";
import AbsenceList from "../components/AbsenceList.jsx";
import { useMyAvailability } from "../hooks/useAvailability.js";

function StatusBanner({ availability }) {
  if (availability.availableNow) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-brand-green/50 bg-brand-green-light px-5 py-4 text-brand-green-ink">
        <CalendarCheck aria-hidden="true" size={22} />
        <p className="text-base font-semibold">Available today</p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-card border border-brand-orange/50 bg-brand-orange-light px-5 py-4 text-brand-orange-ink">
      <CalendarX aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-base font-semibold">
          {availability.current
            ? awayUntil(availability.current)
            : "Not available today"}
        </p>
        <p className="mt-0.5 text-sm">
          You will not be given new tickets while away.
        </p>
      </div>
    </div>
  );
}

/** My availability: today's status, record leave, and my current and future periods. */
export default function MyAvailabilityPage() {
  const query = useMyAvailability();

  if (query.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {query.error.message}
      </p>
    );
  }

  const availability = query.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="My availability"
        description="Record leave so your work is covered while you are away."
      />

      {!availability.inStructure ? (
        <Card className="px-5 py-6">
          <p className="text-sm text-body">
            Leave is recorded here for people who work in a unit or head a
            department.
          </p>
        </Card>
      ) : (
        <>
          <StatusBanner availability={availability} />
          <WhatIHandle />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Record leave"
                description="Whole days, Lagos time. Start and end are included."
              />
              <div className="px-5 py-4">
                <AbsenceForm today={availability.today} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Current and future periods" />
              <div className="px-5 py-2">
                <AbsenceList
                  absences={availability.absences}
                  today={availability.today}
                  emptyText="No leave or out of office recorded."
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
