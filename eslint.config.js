// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "!eslint.config.js"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Tooling/config scripts outside any package's tsconfig — default single-file check instead of a parse error.
          allowDefaultProject: [
            "eslint.config.js",
            "jest.config.cjs",
            ".dependency-cruiser.cjs",
            "prisma.config.ts",
            "packages/admin-web/vite.config.ts",
            "packages/api/scripts/dev-token.ts",
            "packages/api/scripts/generate-openapi.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      // allowDeclarations permits Express's required `declare global { namespace Express {} }` augmentation syntax.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // Some adapters implement an async port synchronously by design (e.g. no-op/in-memory) — not a bug.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // .cjs config files are CommonJS, not part of any package's ESM program.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        exports: "writable",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
