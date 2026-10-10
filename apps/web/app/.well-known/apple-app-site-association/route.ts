import { appleAppSiteAssociation, jsonFile } from "../app-links";

/** iOS universal links (FR-API-4); 404 until APPLE_TEAM_ID and IOS_BUNDLE_ID are set. */
export function GET() {
  return jsonFile(appleAppSiteAssociation());
}
