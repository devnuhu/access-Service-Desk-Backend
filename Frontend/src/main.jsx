import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/app/App.jsx";
import { queryClient } from "@/app/queryClient.js";
import { setupHttp } from "@/app/setupHttp.js";
import "./index.css";

setupHttp(queryClient);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App queryClient={queryClient} />
  </StrictMode>,
);
