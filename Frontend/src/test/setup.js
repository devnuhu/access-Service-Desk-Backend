import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// findBy*/waitFor wait up to 1 s by default. A full parallel run on this machine is slower than
// that (debounced searches, first render of a page), so allow 4 s before a query fails.
configure({ asyncUtilTimeout: 4000 });
