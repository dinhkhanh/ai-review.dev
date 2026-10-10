/**
 * Emitted for every paid call (constraint C-4). Structurally identical to @repo/core's CostEvent,
 * so `costSink(db, ctx)` from core can be passed straight in without this package depending on core.
 */
export interface CostEvent {
  provider: string;
  model?: string;
  operation: string;
  units: number;
  unitType: "tokens" | "credits" | "images" | "seconds" | "characters" | "requests";
  costUsd: number;
  meta?: Record<string, unknown>;
}

export type CostHandler = (event: CostEvent) => void | Promise<void>;
