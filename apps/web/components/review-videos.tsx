import { buildVideoStructuredData } from "@repo/content";
import { publicVideo, publishedVideosForArticle } from "@repo/core";
import { getDb } from "@repo/db";
import { getMessages } from "../lib/i18n";
import { jsonLdScript } from "../lib/render";
import { LiteYouTube } from "./lite-youtube";

/** Video reviews uploaded to YouTube (FR-VID-4), with their VideoObject JSON-LD (FR-CON-9). */
export async function ReviewVideos({ articleId, title }: { articleId: string; title: string }) {
  const videos = (await publishedVideosForArticle(getDb(), articleId).catch(() => [])).map(publicVideo);
  if (videos.length === 0) return null;
  const t = await getMessages();
  const structured = buildVideoStructuredData(
    videos.map((v) => ({
      name: v.title ?? title,
      description: v.description ?? title,
      thumbnailUrl: v.thumbnailUrl,
      uploadDate: v.uploadedAt ?? new Date(),
      embedUrl: v.embedUrl,
      watchUrl: v.watchUrl,
      durationSeconds: v.durationSeconds,
    })),
  );
  return (
    <section aria-labelledby="video-review" className="mt-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(structured) }} />
      <h2 id="video-review" className="text-2xl font-bold tracking-tight">
        {t.video.heading}
      </h2>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        {videos.map((v) => (
          <LiteYouTube
            key={v.youtubeId}
            youtubeId={v.youtubeId}
            title={v.title ?? title}
            thumbnailUrl={v.thumbnailUrl}
            watchUrl={v.watchUrl}
            vertical={v.kind === "short"}
            playLabel={t.video.play(v.title ?? title)}
          />
        ))}
      </div>
    </section>
  );
}
