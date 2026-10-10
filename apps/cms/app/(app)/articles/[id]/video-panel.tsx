import { getSetting, listVideos, videoMedia, type VideoRow } from "@repo/core";
import { getDb } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate, StatusBadge } from "../../../../components/ui";
import { runVideoStageAction, saveVideoScriptAction } from "../video-actions";

const KINDS = [
  { kind: "short", label: "Short (9:16)" },
  { kind: "long", label: "Long (16:9)" },
] as const;

function StageButton({
  articleId,
  kind,
  stage,
  label,
}: {
  articleId: string;
  kind: string;
  stage: string;
  label: string;
}) {
  return (
    <ActionForm action={runVideoStageAction}>
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="stage" value={stage} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Queuing…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

async function VideoCard({
  articleId,
  kind,
  label,
  video,
}: {
  articleId: string;
  kind: string;
  label: string;
  video: VideoRow | undefined;
}) {
  const media = video ? await videoMedia(getDb(), video) : [];
  const mp4 = media.find((m) => m.id === video?.videoAssetId);
  const thumb = media.find((m) => m.id === video?.thumbnailAssetId);
  const audio = media.find((m) => m.id === video?.audioAssetId);
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        {video ? <StatusBadge status={video.status} /> : <span className="text-xs text-muted">not generated</span>}
      </div>
      {video?.error ? <p className="whitespace-pre-wrap text-xs text-danger">{video.error}</p> : null}
      {mp4 ? (
        <video
          controls
          preload="none"
          poster={thumb ? mediaUrl(thumb) : undefined}
          src={mediaUrl(mp4)}
          className={`w-full rounded-md bg-black ${kind === "short" ? "aspect-[9/16]" : "aspect-video"}`}
        />
      ) : audio ? (
        <audio controls preload="none" src={mediaUrl(audio)} className="w-full" />
      ) : null}
      {video ? (
        <p className="text-xs text-muted">
          {video.script ? `${video.script.scenes.length} scenes` : "no script"}
          {video.durationSeconds ? ` · ${video.durationSeconds}s` : ""}
          {video.youtubeId ? (
            <>
              {" · "}
              <a
                href={
                  kind === "short"
                    ? `https://www.youtube.com/shorts/${video.youtubeId}`
                    : `https://youtu.be/${video.youtubeId}`
                }
                target="_blank"
                rel="noopener"
                className="text-brand hover:underline"
              >
                YouTube
              </a>{" "}
              {fmtDate(video.publishedAt)}
            </>
          ) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <StageButton articleId={articleId} kind={kind} stage="all" label={video ? "Regenerate all" : "Generate"} />
        {video?.script ? <StageButton articleId={articleId} kind={kind} stage="script" label="Script" /> : null}
        {video?.script ? <StageButton articleId={articleId} kind={kind} stage="voice" label="Voice" /> : null}
        {video?.audioAssetId ? <StageButton articleId={articleId} kind={kind} stage="render" label="Render" /> : null}
        {video?.videoAssetId ? (
          <StageButton articleId={articleId} kind={kind} stage="upload" label="Upload to YouTube" />
        ) : null}
      </div>
      {video?.script ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted">Edit script (JSON)</summary>
          <ActionForm action={saveVideoScriptAction} className="mt-2 space-y-2">
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="kind" value={kind} />
            <textarea
              name="script"
              rows={14}
              defaultValue={JSON.stringify(video.script, null, 2)}
              className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs"
            />
            <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
              Save script
            </SubmitButton>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}

/** Video versions of the article (FR-VID-1..5): status, preview and per-stage regeneration. */
export async function VideoPanel({ articleId }: { articleId: string }) {
  const db = getDb();
  const [videos, enabled] = await Promise.all([listVideos(db, articleId), getSetting(db, "pipeline.videoEnabled")]);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Video</h2>
      {!enabled ? (
        <p className="text-xs text-muted">
          Automatic videos are off (Settings → pipeline.videoEnabled); manual runs still work.
        </p>
      ) : null}
      {KINDS.map((k) => (
        <VideoCard
          key={k.kind}
          articleId={articleId}
          kind={k.kind}
          label={k.label}
          video={videos.find((v) => v.kind === k.kind)}
        />
      ))}
    </section>
  );
}
