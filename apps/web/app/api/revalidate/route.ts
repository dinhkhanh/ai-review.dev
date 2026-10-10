import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  paths: z.array(z.string().startsWith("/").max(300)).max(50).default([]),
  tags: z.array(z.string().min(1).max(256)).max(50).default([]),
});

function authorized(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * On-demand revalidation called by the CMS and worker after publish/edit (FR-WEB-2, FR-AFF-8).
 * Pages are ISR, so the next request after this renders fresh content.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  for (const path of parsed.data.paths) revalidatePath(path);
  for (const tag of parsed.data.tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: true, paths: parsed.data.paths, tags: parsed.data.tags, now: Date.now() });
}
