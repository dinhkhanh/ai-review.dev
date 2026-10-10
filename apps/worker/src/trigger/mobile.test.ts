import { describe, expect, it } from "vitest";
import { priceAlertPush, pushReceipts } from "./mobile";

describe("mobile tasks (FR-API-4)", () => {
  it("registers the price-alert push cron and the delayed receipts task", () => {
    expect(priceAlertPush.id).toBe("price-alert-push");
    expect(pushReceipts.id).toBe("push-receipts");
  });
});
