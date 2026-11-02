import { Route, Routes } from "react-router-dom";
import { EmailPage } from "@/features/admin-email";
import { PeopleRolesPage } from "@/features/admin-people";
import { LoginPage, RequireRole } from "@/features/auth";
import { HomePage } from "@/features/home";
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
          <Route element={<RequireRole roles={[ROLES.SuperAdmin]} />}>
            <Route path="admin/people" element={<PeopleRolesPage />} />
            <Route path="admin/email" element={<EmailPage />} />
          </Route>
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
