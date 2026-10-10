/**
 * Universal links (iOS) and app links (Android) for the mobile app (FR-API-4). Article pages in
 * every locale open in the app when it is installed; everything else stays on the web.
 */
export const APP_LINK_PATHS = ["/reviews/*", "/compare/*", "/alternatives/*", "/best/*"];
const LOCALE_PREFIXES = ["", "/de"];

export function appleAppSiteAssociation(env: NodeJS.ProcessEnv = process.env) {
  if (!env.APPLE_TEAM_ID || !env.IOS_BUNDLE_ID) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${env.APPLE_TEAM_ID}.${env.IOS_BUNDLE_ID}`],
          components: LOCALE_PREFIXES.flatMap((prefix) => APP_LINK_PATHS.map((path) => ({ "/": `${prefix}${path}` }))),
        },
      ],
    },
  };
}

export function androidAssetLinks(env: NodeJS.ProcessEnv = process.env) {
  if (!env.ANDROID_PACKAGE || !env.ANDROID_CERT_SHA256) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: env.ANDROID_PACKAGE,
        // Comma-separated: the upload key and the Play app-signing key usually both belong here.
        sha256_cert_fingerprints: env.ANDROID_CERT_SHA256.split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      },
    },
  ];
}

export function jsonFile(body: unknown) {
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
