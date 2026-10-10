import { HANDS_ON_STEPS, REVIEW_STEPS, stepsForPreset } from "@repo/pipeline";
import { describe, expect, it } from "vitest";
import { handsOnTrial } from "./hands-on";

describe("hands-on worker task (FR-RES-7)", () => {
  it("registers the trial task and the hands_on step in full reviews", () => {
    expect(handsOnTrial.id).toBe("hands-on-trial");
    expect(stepsForPreset("hands_on")).toEqual(HANDS_ON_STEPS);
    expect(REVIEW_STEPS.indexOf("hands_on")).toBeLessThan(REVIEW_STEPS.indexOf("chunk_embed"));
  });
});
