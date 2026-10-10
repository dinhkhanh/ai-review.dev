import { describe, expect, it } from "vitest";
import { createYouTubeUploader, youTubeMetadata } from "./index";

describe("youTubeMetadata", () => {
  it("enforces YouTube limits and strips angle brackets", () => {
    const meta = youTubeMetadata({
      title: `<b>${"x".repeat(150)}`,
      description: "d".repeat(6000),
      tags: Array.from({ length: 100 }, (_, i) => `tag number ${i}`),
    });
    expect(meta.title).not.toContain("<");
    expect(meta.title.length).toBe(100);
    expect(Buffer.byteLength(meta.description)).toBeLessThanOrEqual(5000);
    const total = meta.tags.reduce((n, t, i) => n + t.length + 2 + (i ? 1 : 0), 0);
    expect(total).toBeLessThanOrEqual(500);
  });
});

describe("createYouTubeUploader", () => {
  it("returns null without credentials", () => {
    expect(createYouTubeUploader(null)).toBeNull();
  });

  it("refreshes a token, opens a resumable session with the synthetic-media flag and uploads", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok" }));
      if (url.includes("uploadType=resumable"))
        return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } });
      if (url === "https://upload.example/session") return new Response(JSON.stringify({ id: "yt123" }));
      if (url.includes("thumbnails/set")) return new Response("{}", { status: 403 });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const up = createYouTubeUploader({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchImpl)!;
    const res = await up.upload({
      video: Buffer.from("mp4"),
      title: "Title",
      description: "Desc",
      tags: ["a"],
      privacyStatus: "private",
      thumbnail: { bytes: Buffer.from("jpg"), mimeType: "image/jpeg" },
    });
    expect(res).toEqual({ videoId: "yt123", thumbnailSet: false });
    const session = JSON.parse(String(seen[1]!.init.body));
    expect(session.status).toMatchObject({
      privacyStatus: "private",
      containsSyntheticMedia: true,
      selfDeclaredMadeForKids: false,
    });
    expect((seen[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
