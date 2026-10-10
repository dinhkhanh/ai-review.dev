import { fileURLToPath } from "node:url";

// All apps share the repo-root .env in development (see .env.example). Variables already set in
// the environment (Vercel, CI) win. Loaded here so Next's build workers inherit them.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No root .env: rely on the platform environment.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  typescript: {
    // Type-checking runs in the `check-types` task (tsc 7); skip the duplicate pass in `next build`.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
