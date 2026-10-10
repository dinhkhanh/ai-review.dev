import { indexNowKeyFrom } from "@repo/core";

/** IndexNow key file (FR-WEB-4), served at /<key>.txt via a rewrite in next.config.js. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const expected = indexNowKeyFrom();
  if (!expected || key !== expected) return new Response("Not found", { status: 404 });
  return new Response(expected, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
