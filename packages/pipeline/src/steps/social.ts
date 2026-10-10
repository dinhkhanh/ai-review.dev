import { articlePath, inlineText, type Block } from "@repo/content";
import { getArticle, getCurrentVersion, setArticleSocial } from "@repo/core";
import type { Llm } from "@repo/ai";
import type { DbOrTx } from "@repo/db";
import { z } from "zod";
import type { ResolvedPrompt } from "../prompts";
import { defineStep } from "../step";

/** Model-facing schema (flat). Lengths are enforced after generation. */
export const socialDraftSchema = z.object({ x: z.string(), linkedin: z.string(), threads: z.string() });

/** What the posts may draw on: title, verdict, score, pros/cons and FAQ questions. No new facts. */
export function socialBrief(title: string, blocks: Block[]) {
  const verdict = blocks.find((b) => b.type === "verdict");
  const pros = blocks.find((b) => b.type === "pros_cons");
  const intro = blocks.find((b) => b.type === "paragraph");
  return [
    `Title: ${title}`,
    verdict?.type === "verdict" ? `Verdict (${verdict.score}/10): ${verdict.summary}` : null,
    verdict?.type === "verdict" && verdict.bestFor.length ? `Best for: ${verdict.bestFor.join("; ")}` : null,
    pros?.type === "pros_cons"
      ? `Pros: ${pros.pros.slice(0, 4).join("; ")}\nCons: ${pros.cons.slice(0, 4).join("; ")}`
      : null,
    intro?.type === "paragraph" ? `Intro: ${inlineText(intro.children).slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Trims to a limit at a word boundary and makes sure the URL is present exactly once. */
export function fitPost(text: string, url: string, max: number): string {
  const body = text.replaceAll(url, "").replace(/\s+\n/g, "\n").trim();
  const room = max - url.length - 2;
  const cut = body.length <= room ? body : `${body.slice(0, room - 1).replace(/\s+\S*$/, "")}…`;
  return `${cut}\n\n${url}`;
}

/** Generates and stores the posts for one article. Shared by the pipeline step and the CMS button. */
export async function generateSocialSnippets(
  deps: { db: DbOrTx; llm: Llm; prompt: ResolvedPrompt; siteUrl: string },
  articleId: string,
) {
  const article = await getArticle(deps.db, articleId);
  const version = await getCurrentVersion(deps.db, articleId);
  if (!article || !version) throw new Error("Article or version not found");
  const url = `${deps.siteUrl.replace(/\/$/, "")}${articlePath(article.type, article.slug)}`;
  const res = await deps.llm.generateStructured({
    model: deps.prompt.model,
    effort: deps.prompt.effort,
    system: deps.prompt.system,
    operation: "social",
    maxTokens: 4_000,
    schema: socialDraftSchema,
    prompt: `${socialBrief(article.title, version.blocks)}\n\nLink to include: ${url}`,
  });
  const snippets = {
    x: fitPost(res.data.x, url, 280),
    linkedin: fitPost(res.data.linkedin, url, 3000),
    threads: fitPost(res.data.threads, url, 500),
    url,
    generatedAt: new Date().toISOString(),
  };
  await setArticleSocial(deps.db, article.id, snippets);
  return { snippets, model: res.model };
}

/**
 * social (FR-CON-8): short X / LinkedIn / Threads posts linking to the article page (which carries
 * the CTAs and the affiliate disclosure). Optional: never blocks the article.
 */
export const socialStep = defineStep({
  name: "social",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({ url: z.string(), chars: z.object({ x: z.number(), linkedin: z.number(), threads: z.number() }) }),
  async run(ctx, input) {
    const prompt = await ctx.prompt("social");
    const { snippets, model } = await generateSocialSnippets(
      { db: ctx.db, llm: ctx.llm, prompt, siteUrl: ctx.publishEnv.siteUrl },
      input.articleId,
    );
    return {
      output: {
        url: snippets.url,
        chars: { x: snippets.x.length, linkedin: snippets.linkedin.length, threads: snippets.threads.length },
      },
      model,
      promptVersion: prompt.version,
    };
  },
});
