import { z } from "zod";

/** What a scene shows (FR-VID-3). Visuals reference article data or media assets, never free URLs. */
export const sceneVisualSchema = z.enum([
  "title",
  "screenshot",
  "score",
  "pricing",
  "pros_cons",
  "comparison",
  "verdict",
  "outro",
]);
export type SceneVisual = z.infer<typeof sceneVisualSchema>;

export const videoSceneSchema = z.object({
  id: z.string().min(1),
  /** Voice-over text for the scene. */
  narration: z.string(),
  /** Short on-screen text (headline or bullet). */
  onScreenText: z.string(),
  visual: sceneVisualSchema,
  /** Media asset shown for screenshot scenes. */
  assetId: z.uuid().optional(),
});
export type VideoScene = z.infer<typeof videoSceneSchema>;

/** Video script generated from an approved article (FR-VID-1). Stored on `videos.script`. */
export const videoScriptSchema = z.object({
  kind: z.enum(["short", "long"]),
  title: z.string().max(100),
  /** YouTube description body; the disclosure and go-link are appended when uploading (FR-VID-4). */
  description: z.string().max(4000),
  tags: z.array(z.string()).max(30),
  scenes: z.array(videoSceneSchema).min(1),
});
export type VideoScript = z.infer<typeof videoScriptSchema>;
