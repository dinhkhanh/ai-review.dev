import { androidAssetLinks, jsonFile } from "../app-links";

/** Android app links (FR-API-4); 404 until ANDROID_PACKAGE and ANDROID_CERT_SHA256 are set. */
export function GET() {
  return jsonFile(androidAssetLinks());
}
