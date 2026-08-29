import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Enforce unknown over any in catch blocks
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // No console.log (use pino logger)
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Prefer const
      "prefer-const": "warn",
      // No var
      "no-var": "error",
      // Require strict equality, while preserving intentional `value == null`
      // nullish checks that cover both null and undefined.
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    ignores: [
      "dist/**",
      "client/public/**",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "workers/**",
      "mobile/**",
      "infra/**",
      "scripts/**",
      "*.test.ts",
      "*.test.tsx",
      "*.spec.ts",
      "deliverables/**",
    ],
  }
);
