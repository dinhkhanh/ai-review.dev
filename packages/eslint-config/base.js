import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";
import globals from "globals";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    // Babel 8's TypeScript preset does not enable JSX parsing for .tsx through eslint-parser.
    files: ["**/*.tsx"],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          presets: ["@babel/preset-typescript"],
          parserOpts: { plugins: ["jsx"] },
        },
      },
    },
  },
  {
    // Plain JS config files and scripts run on Node.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // TypeScript (tsc --noEmit) already reports undefined names and unused locals,
    // and the Babel parser does not track type-only references, so these core rules
    // produce false positives on .ts/.tsx files.
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
    },
  },
  {
    ignores: ["dist/**", "coverage/**", ".turbo/**", ".trigger/**", "drizzle/meta/**"],
  },
];
