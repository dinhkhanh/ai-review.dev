import { REVIEW_STEPS } from "@repo/pipeline";
import { describe, expect, it } from "vitest";
import {
  affiliateReminders,
  importPageViews,
  linkHealth,
  linkHealthNow,
  syncConversionsDaily,
  syncConversionsNow,
} from "./affiliate-ops";
import { refreshScheduler } from "./refresh";
import { reviewProduct } from "./review-product";
import { publishScheduled } from "./scheduled";
import { rebuildSearchText, searchBackfill } from "./site-ops";
import { productSourcing, productSourcingNow } from "./sourcing";
import { generateVideo, videoAutogen } from "./video";

describe("worker tasks", () => {
  it("registers the review and scheduled-publish tasks", () => {
    expect(reviewProduct.id).toBe("review-product");
    expect(publishScheduled.id).toBe("publish-scheduled");
    expect(REVIEW_STEPS[0]).toBe("resolve_product");
    expect(REVIEW_STEPS.at(-1)).toBe("publish");
  });

  it("registers the refresh scheduler (FR-MNT-1)", () => {
    expect(refreshScheduler.id).toBe("refresh-scheduler");
  });

  it("registers the product sourcing tasks (FR-INT-7)", () => {
    expect(productSourcing.id).toBe("product-sourcing");
    expect(productSourcingNow.id).toBe("product-sourcing-now");
  });

  it("registers the affiliate ops and analytics tasks (FR-AFF-10, FR-AFF-11, FR-ANL-2)", () => {
    expect(linkHealth.id).toBe("link-health");
    expect(linkHealthNow.id).toBe("link-health-now");
    expect(affiliateReminders.id).toBe("affiliate-reminders");
    expect(syncConversionsDaily.id).toBe("sync-conversions");
    expect(syncConversionsNow.id).toBe("sync-conversions-now");
    expect(importPageViews.id).toBe("import-page-views");
  });

  it("registers the search index tasks (FR-WEB-7)", () => {
    expect(searchBackfill.id).toBe("search-backfill");
    expect(rebuildSearchText.id).toBe("rebuild-search-text");
  });

  it("registers the video tasks (FR-VID-1..5)", () => {
    expect(generateVideo.id).toBe("generate-video");
    expect(videoAutogen.id).toBe("video-autogen");
  });
});
