import { useParams } from "react-router-dom";
import UnitDashboard from "../components/UnitDashboard.jsx";

/**
 * /dashboard/unit/:unitId: one unit's dashboard (the HOD overview's rows open it). The server
 * decides who may see it; a 403 shows a plain "not allowed" page.
 */
export default function UnitDashboardPage() {
  const { unitId } = useParams();
  return <UnitDashboard key={unitId} unitId={unitId} back="/" />;
}
