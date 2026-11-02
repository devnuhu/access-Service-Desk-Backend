import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

// Files written before the API layer existed. They still build URLs themselves; each one leaves
// this list when its feature moves to src/features/<feature>/api/endpoints.js.
const LEGACY_API_FILES = [];

const API_PATH_MESSAGE =
  "Declare API routes only in src/features/<feature>/api/endpoints.js (checked by npm run check:api).";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // JSX belongs in .jsx files only; JSX in a .js file is a parse error.
    files: ["**/*.js"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: false } } },
  },
  {
    files: ["scripts/**/*.js", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: [
      "src/features/*/api/endpoints.js",
      "src/shared/lib/http/endpoint.js",
      "src/**/*.test.{js,jsx}",
      ...LEGACY_API_FILES,
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/^\\/api\\//]", message: API_PATH_MESSAGE },
        {
          selector: "TemplateElement[value.raw=/^\\/api\\//]",
          message: API_PATH_MESSAGE,
        },
      ],
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message:
                "Import another feature only through its index.js: @/features/<feature>.",
            },
          ],
        },
      ],
    },
  },
  {
    // Shared code must not depend on features.
    files: ["src/shared/**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features", "@/features/*", "**/features/**"],
              message: "src/shared must not import features.",
            },
          ],
        },
      ],
    },
  },
  {
    // check-api.js loads these files in Node, which resolves neither "@/" nor missing extensions.
    files: ["src/features/*/api/endpoints.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message: "Use relative imports with .js extensions here.",
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
