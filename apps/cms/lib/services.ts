import { createFirecrawl, createLlm, createVoyageEmbedder } from "@repo/ai";
import { getDb } from "@repo/db";
import type { StepServices } from "@repo/pipeline/editor";

/** AI clients for in-CMS actions (section regenerate, candidate search). No media storage here. */
export function cmsServices(): StepServices {
  return {
    db: getDb(),
    makeLlm: (onCost) => createLlm({ onCost }),
    makeFirecrawl: (onCost) => createFirecrawl({ onCost }),
    makeEmbedder: (onCost) => createVoyageEmbedder({ onCost }),
  };
}
