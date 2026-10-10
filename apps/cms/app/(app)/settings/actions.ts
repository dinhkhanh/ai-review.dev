"use server";

import {
  activatePromptVersion,
  recordAudit,
  savePromptVersion,
  setSetting,
  settingSchemas,
  type SettingKey,
} from "@repo/core";
import { authors, categories, eq, getDb } from "@repo/db";
import { PROMPT_KEYS } from "@repo/pipeline/editor";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../../../lib/auth";

export type ActionState = { ok: boolean; message: string } | null;

const admin = () => requireUser({ roles: ["admin"] });

export async function saveSettingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await admin();
  const key = String(form.get("key")) as SettingKey;
  if (!(key in settingSchemas)) return { ok: false, message: "Unknown setting" };
  let value: unknown;
  try {
    value = JSON.parse(String(form.get("value") ?? ""));
  } catch {
    return { ok: false, message: "Value must be JSON (strings in double quotes)" };
  }
  const parsed = settingSchemas[key].safeParse(value);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") };
  await setSetting(getDb(), key, parsed.data as never, user.id);
  await recordAudit(getDb(), { actorUserId: user.id, action: "settings.update", entityType: "setting", entityId: key });
  revalidatePath("/settings");
  return { ok: true, message: `Saved ${key}` };
}

export async function savePromptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await admin();
  const key = String(form.get("key"));
  if (!(PROMPT_KEYS as string[]).includes(key)) return { ok: false, message: "Unknown prompt" };
  try {
    const row = await savePromptVersion(getDb(), {
      key,
      body: String(form.get("body") ?? ""),
      notes: String(form.get("notes") ?? "") || null,
      userId: user.id,
      activate: form.get("activate") === "on",
    });
    await recordAudit(getDb(), {
      actorUserId: user.id,
      action: "prompt.save",
      entityType: "prompt",
      entityId: `${key}@v${row.version}`,
    });
    revalidatePath("/settings");
    return { ok: true, message: `Saved ${key} v${row.version}${row.active ? " (active)" : ""}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function activatePromptAction(form: FormData) {
  const user = await admin();
  const key = String(form.get("key"));
  const raw = String(form.get("version") ?? "");
  const version = raw ? Number(raw) : null;
  await activatePromptVersion(getDb(), key, version);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: "prompt.activate",
    entityType: "prompt",
    entityId: `${key}@${version ?? "repo"}`,
  });
  revalidatePath("/settings");
}

const rubricSchema = z
  .array(z.object({ key: z.string().min(1), label: z.string().min(1), weight: z.number().positive() }))
  .min(3)
  .max(8)
  .refine((dims) => Math.abs(dims.reduce((s, d) => s + d.weight, 0) - 1) < 0.001, "Weights must sum to 1");

/** Per-category rubric (FR-CON-3). Empty value reverts to the default rubric. */
export async function saveRubricAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await admin();
  const id = String(form.get("categoryId"));
  const raw = String(form.get("rubric") ?? "").trim();
  let rubric: z.infer<typeof rubricSchema> | null = null;
  if (raw) {
    try {
      const parsed = rubricSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
      rubric = parsed.data;
    } catch {
      return { ok: false, message: "Rubric must be JSON" };
    }
  }
  await getDb().update(categories).set({ rubric }).where(eq(categories.id, id));
  await recordAudit(getDb(), { actorUserId: user.id, action: "category.rubric", entityType: "category", entityId: id });
  revalidatePath("/settings");
  return { ok: true, message: rubric ? "Rubric saved" : "Reverted to the default rubric" };
}

export async function saveAuthorAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await admin();
  const id = String(form.get("authorId"));
  let links: Record<string, string>;
  try {
    links = z.record(z.string(), z.url()).parse(JSON.parse(String(form.get("links") || "{}")));
  } catch {
    return { ok: false, message: 'Links must be JSON like {"LinkedIn": "https://…"}' };
  }
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name is required" };
  await getDb()
    .update(authors)
    .set({ name, bio: String(form.get("bio") ?? "").trim() || null, links })
    .where(eq(authors.id, id));
  await recordAudit(getDb(), { actorUserId: user.id, action: "author.update", entityType: "author", entityId: id });
  revalidatePath("/settings");
  return { ok: true, message: "Author saved (live author pages refresh within the hour)" };
}
