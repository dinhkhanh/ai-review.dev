/**
 * YouTube Data API v3 upload (FR-VID-4). Authenticates with an OAuth refresh token for the
 * channel, uploads through a resumable session and always declares altered/synthetic content
 * (`status.containsSyntheticMedia`), since narration is AI-generated.
 */
export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function youTubeCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): YouTubeCredentials | null {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) return null;
  return { clientId: YOUTUBE_CLIENT_ID, clientSecret: YOUTUBE_CLIENT_SECRET, refreshToken: YOUTUBE_REFRESH_TOKEN };
}

export interface YouTubeUploadInput {
  video: Buffer;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "private" | "unlisted" | "public";
  /** YouTube category; 28 = Science & Technology. */
  categoryId?: string;
  thumbnail?: { bytes: Buffer; mimeType: string } | null;
}

export interface YouTubeUploadResult {
  videoId: string;
  thumbnailSet: boolean;
}

export interface YouTubeUploader {
  upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult>;
}

/** YouTube limits: title ≤ 100 chars, description ≤ 5000 bytes, tags ≤ 500 chars in total, no angle brackets. */
export function youTubeMetadata(input: Pick<YouTubeUploadInput, "title" | "description" | "tags">) {
  const strip = (s: string) => s.replace(/[<>]/g, "");
  const title = strip(input.title).trim().slice(0, 100);
  let description = strip(input.description);
  while (Buffer.byteLength(description, "utf8") > 5000) description = description.slice(0, -50);
  const tags: string[] = [];
  let total = 0;
  for (const raw of input.tags) {
    const tag = strip(raw).trim();
    if (!tag) continue;
    // Tags with spaces count their surrounding quotes.
    const len = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (total + len > 500) break;
    tags.push(tag);
    total += len;
  }
  return { title, description, tags };
}

async function accessToken(creds: YouTubeCredentials, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`YouTube OAuth failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("YouTube OAuth returned no access token");
  return body.access_token;
}

export function createYouTubeUploader(
  creds: YouTubeCredentials | null = youTubeCredentialsFromEnv(),
  fetchImpl: typeof fetch = fetch,
): YouTubeUploader | null {
  if (!creds) return null;
  return {
    async upload(input) {
      const token = await accessToken(creds, fetchImpl);
      const meta = youTubeMetadata(input);
      const session = await fetchImpl(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": String(input.video.length),
          },
          body: JSON.stringify({
            snippet: { ...meta, categoryId: input.categoryId ?? "28", defaultLanguage: "en" },
            status: {
              privacyStatus: input.privacyStatus,
              selfDeclaredMadeForKids: false,
              containsSyntheticMedia: true,
              embeddable: true,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const location = session.headers.get("location");
      if (!session.ok || !location) {
        throw new Error(
          `YouTube upload session failed: HTTP ${session.status} ${(await session.text()).slice(0, 300)}`,
        );
      }
      const put = await fetchImpl(location, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" },
        body: new Uint8Array(input.video),
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!put.ok) throw new Error(`YouTube upload failed: HTTP ${put.status} ${(await put.text()).slice(0, 300)}`);
      const video = (await put.json()) as { id?: string };
      if (!video.id) throw new Error("YouTube upload returned no video id");

      // Custom thumbnails need a verified channel; a failure here is not fatal.
      let thumbnailSet = false;
      if (input.thumbnail) {
        const res = await fetchImpl(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": input.thumbnail.mimeType },
            body: new Uint8Array(input.thumbnail.bytes),
            signal: AbortSignal.timeout(60_000),
          },
        ).catch(() => null);
        thumbnailSet = !!res?.ok;
      }
      return { videoId: video.id, thumbnailSet };
    },
  };
}
