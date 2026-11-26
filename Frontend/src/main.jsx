import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/app/App.jsx";
import { queryClient } from "@/app/queryClient.js";
import { setupHttp } from "@/app/setupHttp.js";
// The wordmark's font, served from our own assets (no outside font host): Plus Jakarta Sans,
// latin, weight 800 only, the one weight the wordmark uses.
import "@fontsource/plus-jakarta-sans/latin-800.css";
import "./index.css";

setupHttp(queryClient);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App queryClient={queryClient} />
  </StrictMode>,
);
