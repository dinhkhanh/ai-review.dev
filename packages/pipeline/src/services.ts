import { createFirecrawl, createLlm, createVoyageEmbedder } from "@repo/ai";
import type { Database } from "@repo/db";
import { createStorage } from "@repo/media";
import type { StepServices } from "./step";

/** Production wiring: real Anthropic, Firecrawl and Voyage clients and R2 (or DB) storage, from env. */
export function createStepServices(db: Database): StepServices {
  return {
    db,
    makeLlm: (onCost) => createLlm({ onCost }),
    makeFirecrawl: (onCost) => createFirecrawl({ onCost }),
    makeEmbedder: (onCost) => createVoyageEmbedder({ onCost }),
    storage: createStorage(db),
  };
}
