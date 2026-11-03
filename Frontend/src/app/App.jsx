import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import AppRoutes from "@/routes/AppRoutes.jsx";
import { ToastProvider } from "@/shared/ui";

// A data router (one splat route around <AppRoutes />), so pages can use useBlocker to ask before
// leaving with unsaved changes.
const router = createBrowserRouter([{ path: "*", element: <AppRoutes /> }]);

export default function App({ queryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
