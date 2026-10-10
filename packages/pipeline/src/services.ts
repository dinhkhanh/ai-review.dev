import { createFirecrawl, createLlm } from "@repo/ai";
import type { Database } from "@repo/db";
import type { StepServices } from "./step";

/** Production wiring: real Anthropic + Firecrawl clients, keys from the environment. */
export function createStepServices(db: Database): StepServices {
  return {
    db,
    makeLlm: (onCost) => createLlm({ onCost }),
    makeFirecrawl: (onCost) => createFirecrawl({ onCost }),
  };
}
