import { REVIEW_STEPS } from "@repo/pipeline";
import { describe, expect, it } from "vitest";
import { reviewProduct } from "./review-product";
import { publishScheduled } from "./scheduled";

describe("worker tasks", () => {
  it("registers the review and scheduled-publish tasks", () => {
    expect(reviewProduct.id).toBe("review-product");
    expect(publishScheduled.id).toBe("publish-scheduled");
    expect(REVIEW_STEPS[0]).toBe("resolve_product");
    expect(REVIEW_STEPS.at(-1)).toBe("qa_gates");
  });
});
