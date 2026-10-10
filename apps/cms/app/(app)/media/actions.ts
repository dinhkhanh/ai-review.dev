"use server";

import { buildIllustrationPrompt, createFalImageGenerator } from "@repo/ai";
import {
  costSink,
  DomainError,
  getMediaAsset,
  insertImageIntoArticle,
  loadArticleRenderData,
  recordAudit,
  setVersionQa,
  updateMediaAlt,
} from "@repo/core";
import { getDb } from "@repo/db";
import {
  createStorage,
  downloadImage,
  parseAnnotations,
  processScreenshot,
  readAssetBytes,
  saveImageAsset,
  saveProcessedScreenshot,
  type ProcessScreenshotOptions,
} from "@repo/media";
import { computeQaScorecard } from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";

export type ActionState = { ok: boolean; message: string } | null;
export type PreviewState = { ok: boolean; message: string; preview?: string } | null;

function fail(error: unknown): { ok: false; message: string } {
  if (error instanceof DomainError) return { ok: false, message: error.message };
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

/** Alt text edits from the library grid and detail page (FR-CMS-9). */
export async function updateAltAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(form.get("assetId"));
  const alt = String(form.get("alt") ?? "").trim();
  try {
    await updateMediaAlt(getDb(), id, alt);
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "media.alt",
      entityType: "media_asset",
      entityId: id,
      data: { alt: alt.slice(0, 300) },
    });
    revalidatePath("/media");
    revalidatePath(`/media/${id}`);
    return { ok: true, message: alt ? "Saved" : "Alt text cleared" };
  } catch (error) {
    return fail(error);
  }
}

const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));

/** Reads the processing form (FR-MED-3) into options; throws on invalid input. */
function processOptions(form: FormData, host: string | null): ProcessScreenshotOptions {
  const frame = String(form.get("frame") ?? "");
  const values = ["cropX", "cropY", "cropW", "cropH"].map((k) => num(form.get(k)));
  let crop: ProcessScreenshotOptions["crop"] = null;
  if (values.some((v) => v !== null)) {
    const [x, y, width, height] = values;
    if (x == null || y == null || width == null || height == null || !values.every((v) => Number.isFinite(v))) {
      throw new DomainError("invalid", "Crop needs four numbers: x, y, width and height");
    }
    crop = { x, y, width, height };
  }
  const { annotations, errors } = parseAnnotations(String(form.get("annotations") ?? ""));
  if (errors.length) throw new DomainError("invalid", errors.join("; "));
  return {
    crop,
    frame: frame === "browser" || frame === "phone" ? frame : null,
    annotations,
    host: String(form.get("host") ?? "").trim() || host,
  };
}

async function loadScreenshot(id: string) {
  const asset = await getMediaAsset(getDb(), id);
  if (!asset) throw new DomainError("not_found", "Media asset not found");
  if (asset.kind === "video" || asset.kind === "audio")
    throw new DomainError("invalid", "Only images can be processed");
  return asset;
}

/** Renders a preview of crop/frame/annotations without storing anything. */
export async function previewProcessAction(_prev: PreviewState, form: FormData): Promise<PreviewState> {
  await requireUser();
  try {
    const asset = await loadScreenshot(String(form.get("assetId")));
    const opts = processOptions(form, null);
    const original = await readAssetBytes(asset, createStorage(getDb()));
    const out = await processScreenshot(original, { ...opts, maxWidth: 1200 });
    return {
      ok: true,
      message: `Preview ${out.width}×${out.height} (saved version is full size)`,
      preview: `data:image/webp;base64,${out.bytes.toString("base64")}`,
    };
  } catch (error) {
    return fail(error);
  }
}

/** Stores the processed screenshot as a new asset linked to the original (FR-MED-3). */
export async function saveProcessedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const db = getDb();
    const asset = await loadScreenshot(String(form.get("assetId")));
    const opts = processOptions(form, null);
    const saved = await saveProcessedScreenshot(db, createStorage(db), asset, { ...opts, maxWidth: 2400 });
    await recordAudit(db, {
      actorUserId: user.id,
      action: "media.process",
      entityType: "media_asset",
      entityId: saved.id,
      data: { parentAssetId: asset.id, frame: opts.frame, annotations: opts.annotations?.length ?? 0 },
    });
    revalidatePath(`/media/${asset.id}`);
    return { ok: true, message: "Saved as a new asset (see Processed versions below)" };
  } catch (error) {
    return fail(error);
  }
}

async function refreshQa(articleId: string, versionId: string) {
  const qaScorecard = await computeQaScorecard(getDb(), articleId, versionId);
  await setVersionQa(getDb(), versionId, { qaScorecard });
}

/**
 * Generates an illustrative image for an article (FR-MED-2). The prompt is a deterministic
 * template from the category and audiences with product/competitor names removed, so the model
 * has no brand to draw; the result is stored as a `generated` asset with a licence note.
 */
export async function generateIllustrationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const db = getDb();
  try {
    const data = await loadArticleRenderData(db, articleId);
    if (!data) throw new DomainError("not_found", "Article not found");
    const generator = createFalImageGenerator({ onCost: costSink(db, {}) });
    if (!generator) throw new DomainError("invalid", "Image generation is off: set FAL_KEY");
    const verdict = data.version.blocks.find((b) => b.type === "verdict");
    const avoidNames = [
      ...(data.product ? [data.product.name] : []),
      ...data.competitors.map((c) => c.name),
      data.article.title.split(/[:—–-]/)[0] ?? "",
    ];
    const prompt = buildIllustrationPrompt({
      categorySlug: data.category?.slug,
      categoryName: data.category?.name,
      themes: verdict?.type === "verdict" ? verdict.bestFor : [],
      avoidNames,
    });
    const image = await generator.generate({ prompt });
    const bytes = await downloadImage(image.url);
    const asset = await saveImageAsset(db, createStorage(db), {
      bytes,
      kind: "image",
      origin: "generated",
      prefix: `articles/${articleId}/generated`,
      role: "illustration",
      alt: `Abstract illustration for ${data.category?.name ?? "software"} (decorative)`,
      productId: data.product?.id ?? null,
      articleId,
      licenseNote: `AI-generated illustration (${image.model} via fal.ai, seed ${image.seed ?? "n/a"}); not a product screenshot.`,
    });
    await recordAudit(db, {
      actorUserId: user.id,
      action: "media.generate",
      entityType: "media_asset",
      entityId: asset.id,
      data: { articleId, model: image.model, prompt },
    });
    revalidatePath(`/articles/${articleId}`);
    revalidatePath("/media");
    return { ok: true, message: "Image generated. Review it, then insert it into the article." };
  } catch (error) {
    return fail(error);
  }
}

/** Adds an image block after the intro as a new version and recomputes QA (never replaces screenshots). */
export async function insertIntoArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const articleId = String(form.get("articleId"));
  const assetId = String(form.get("assetId"));
  const db = getDb();
  try {
    const version = await insertImageIntoArticle(db, {
      articleId,
      assetId,
      caption: String(form.get("caption") ?? "") || null,
      userId: user.id,
    });
    await refreshQa(articleId, version.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: "article.insert_image",
      entityType: "article",
      entityId: articleId,
      data: { assetId, version: version.version },
    });
    revalidatePath(`/articles/${articleId}`);
    revalidatePath(`/media/${assetId}`);
    return { ok: true, message: `Inserted as v${version.version}` };
  } catch (error) {
    return fail(error);
  }
}
