import { canTransition, getArticle, getCurrentVersion, setVersionQa, transitionArticle } from "@repo/core";
import { z } from "zod";
import { computeQaScorecard } from "../qa";
import { defineStep } from "../step";

/** qa_gates (FR-QA-1, FR-QA-5): scorecard on the current version, then hand over to the editor (D-3). */
export const qaGatesStep = defineStep({
  name: "qa_gates",
  input: z.object({ articleId: z.uuid() }),
  output: z.object({ hardGatesPassed: z.boolean(), failed: z.array(z.string()), status: z.string() }),
  async run(ctx, input) {
    const article = await getArticle(ctx.db, input.articleId);
    const version = await getCurrentVersion(ctx.db, input.articleId);
    if (!article || !version) throw new Error("Article or version not found");
    const scorecard = await computeQaScorecard(ctx.db, article.id, version.id);
    await setVersionQa(ctx.db, version.id, { qaScorecard: scorecard });
    let status = article.status;
    if (canTransition(article.status, "in_review")) {
      status = (await transitionArticle(ctx.db, article.id, "in_review")).status;
    }
    const failed = scorecard.checks.filter((c) => !c.passed).map((c) => c.key);
    ctx.log("QA scorecard", { hardGatesPassed: scorecard.hardGatesPassed, failed });
    return { output: { hardGatesPassed: scorecard.hardGatesPassed, failed, status } };
  },
});
