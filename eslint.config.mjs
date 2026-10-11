import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const nodeGlobals = {
  Buffer: "readonly",
  URL: "readonly",
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/.next/**", "**/next-env.d.ts", "**/playwright-report/**", "**/test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      globals: nodeGlobals,
      sourceType: "module",
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/design-system/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@auto-world/connector-sdk", "@auto-world/source-registry", "@auto-world/vehicle-schema", "**/connectors/**", "**/services/**", "**/source-registry/**", "**/vehicle-schema/**", "**/test/**"],
          message: "Presentation code cannot import data authority or test fixtures; use a separately accepted public contract.",
        }],
      }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: { document: "readonly", window: "readonly", HTMLElement: "readonly" } },
  },
);
