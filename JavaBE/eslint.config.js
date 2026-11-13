import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist", "public", "**/*.js", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/globals": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-this-alias": "off",
      "prefer-const": "off",
      "no-var": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-constant-condition": "off",
      "no-prototype-builtins": "off",
      "no-dupe-else-if": "error",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-self-assign": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "no-irregular-whitespace": "off",
      "no-loss-of-precision": "off",
      "no-shadow-restricted-names": "off",
      "no-misleading-character-class": "off",
      "no-constant-binary-expression": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "no-unassigned-vars": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "error",
    },
  },
];
