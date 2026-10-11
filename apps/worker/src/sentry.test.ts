import { describe, expect, it } from "vitest";
import { failureTags, initSentry, reportRunFailure } from "./sentry";

describe("worker Sentry", () => {
  it("tags failures with task, run and record ids from the payload", () => {
    expect(
      failureTags(
        { task: { id: "review-product" }, run: { id: "run_1" }, attempt: { number: 3 }, environment: { slug: "prod" } },
        { jobId: "8b1c", email: "a@b.de", issueId: 42 },
      ),
    ).toEqual({ task: "review-product", run_id: "run_1", attempt: "3", trigger_env: "prod", job_id: "8b1c" });
    expect(failureTags({ task: { id: "t" }, run: { id: "r" } }, undefined)).toEqual({ task: "t", run_id: "r" });
  });

  it("stays inert without a DSN", async () => {
    expect(initSentry({})).toBe(false);
    await expect(
      reportRunFailure(new Error("x"), { task: { id: "t" }, run: { id: "r" } }, {}),
    ).resolves.toBeUndefined();
  });
});
