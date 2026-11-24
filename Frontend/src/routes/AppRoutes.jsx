import { Route, Routes } from "react-router-dom";
import { CategoriesPage, SkillsMatrixPage } from "@/features/admin-catalogue";
import { EmailPage } from "@/features/admin-email";
import { HolidaysPage } from "@/features/admin-holidays";
import { PriorityMatrixPage } from "@/features/admin-priority";
import { ServiceLevelsPage } from "@/features/admin-sla";
import { SharedRepliesPage } from "@/features/canned-replies";
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
import { HomePage, UnitDashboardPage } from "@/features/home";
import {
  ArticleEditorPage,
  ArticlePage,
  KnowledgePage,
  ManageArticlesPage,
} from "@/features/knowledge";
import { MyUnitPage } from "@/features/my-unit";
import { ReportsPage } from "@/features/reports";
import {
  MyRequestsPage,
  NewTicketPage,
  TicketPage,
  WorkQueuePage,
} from "@/features/tickets";
import AppLayout from "@/layouts/AppLayout.jsx";
import { REPORT_ROLES, ROLES } from "@/shared/lib/roles";
import { NoAccessPage, NotFoundPage } from "./StatusPages.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireRole />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route
            path="dashboard/unit/:unitId"
            element={<UnitDashboardPage />}
          />
          <Route path="units/:unitId" element={<MyUnitPage />} />
          <Route path="availability" element={<MyAvailabilityPage />} />
          <Route path="tickets" element={<MyRequestsPage />} />
          <Route path="tickets/new" element={<NewTicketPage />} />
          <Route path="tickets/id/:id" element={<TicketPage />} />
          <Route path="tickets/:reference" element={<TicketPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="knowledge/manage" element={<ManageArticlesPage />} />
          <Route path="knowledge/manage/new" element={<ArticleEditorPage />} />
          <Route
            path="knowledge/manage/:id/edit"
            element={<ArticleEditorPage />}
          />
          <Route path="knowledge/:id" element={<ArticlePage />} />
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
          <Route element={<RequireRole roles={REPORT_ROLES} />}>
            <Route path="reports" element={<ReportsPage />} />
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
            <Route path="admin/holidays" element={<HolidaysPage />} />
            <Route
              path="admin/service-levels"
              element={<ServiceLevelsPage />}
            />
            <Route
              path="admin/priority-matrix"
              element={<PriorityMatrixPage />}
            />
            <Route path="admin/replies" element={<SharedRepliesPage />} />
            <Route path="admin/email" element={<EmailPage />} />
          </Route>
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
