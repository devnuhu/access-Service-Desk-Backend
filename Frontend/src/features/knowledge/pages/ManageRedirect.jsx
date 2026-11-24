import { Navigate } from "react-router-dom";
import { MY_ARTICLES } from "../places.js";

/** The old Write articles address (/knowledge/manage): the knowledge base on its second tab. */
export default function ManageRedirect() {
  return <Navigate to={MY_ARTICLES} replace />;
}
