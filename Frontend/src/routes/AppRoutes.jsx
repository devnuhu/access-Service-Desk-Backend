import { Route, Routes } from "react-router-dom";
import { CategoriesPage, SkillsMatrixPage } from "@/features/admin-catalogue";
import { EmailPage } from "@/features/admin-email";
import { LocationsPage } from "@/features/admin-locations";
import { PeopleRolesPage } from "@/features/admin-people";
import { UnitPage, UnitsPage } from "@/features/admin-units";
import { LoginPage, RequireRole } from "@/features/auth";
import {
  DepartmentAvailabilityPage,
  MyAvailabilityPage,
  RequireTeamAccess,
  UnitAvailabilityPage,
} from "@/features/availability";
import { HomePage } from "@/features/home";
import {
  MyRequestsPage,
  NewTicketPage,
  TicketPage,
  WorkQueuePage,
} from "@/features/tickets";
import AppLayout from "@/layouts/AppLayout.jsx";
import { ROLES } from "@/shared/lib/roles";
import { NoAccessPage, NotFoundPage } from "./StatusPages.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireRole />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="availability" element={<MyAvailabilityPage />} />
          <Route path="tickets" element={<MyRequestsPage />} />
          <Route path="tickets/new" element={<NewTicketPage />} />
          <Route path="tickets/id/:id" element={<TicketPage />} />
          <Route path="tickets/:reference" element={<TicketPage />} />
          <Route
            path="departments/:departmentId/tickets"
            element={<WorkQueuePage />}
          />
          <Route element={<RequireTeamAccess />}>
            <Route
              path="availability/units/:unitId"
              element={<UnitAvailabilityPage />}
            />
            <Route
              path="availability/departments/:departmentId"
              element={<DepartmentAvailabilityPage />}
            />
          </Route>
          <Route element={<RequireRole roles={[ROLES.SuperAdmin]} />}>
            <Route path="admin/people" element={<PeopleRolesPage />} />
            <Route path="admin/units" element={<UnitsPage />} />
            <Route path="admin/units/:unitId" element={<UnitPage />} />
            <Route
              path="admin/units/:unitId/skills"
              element={<SkillsMatrixPage />}
            />
            <Route path="admin/categories" element={<CategoriesPage />} />
            <Route path="admin/locations" element={<LocationsPage />} />
            <Route path="admin/email" element={<EmailPage />} />
          </Route>
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
