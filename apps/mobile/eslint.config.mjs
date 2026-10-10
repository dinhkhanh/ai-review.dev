import { config } from "@repo/eslint-config/react-internal";

export default [
  { ignores: [".expo/**", "dist-check/**", "expo-env.d.ts"] },
  ...config,
  // Metro config is CommonJS; asset `require`s run through Metro.
  {
    languageOptions: {
      globals: { require: "readonly", module: "writable", __dirname: "readonly", process: "readonly" },
    },
  },
];
