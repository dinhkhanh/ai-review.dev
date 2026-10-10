import type { Block } from "@repo/content";
import { sectionKeyOf } from "../section";

/**
 * Section-level re-translation. A "unit" is a review section (`sec-<key>-*` blocks, translated
 * together so the prose stays coherent) or a single standalone block (verdict, CTA, pricing table…).
 */
export function unitOf(blockId: string): string {
  const section = sectionKeyOf(blockId);
  return section ? `sec-${section}` : blockId;
}

/** Units whose blocks were added, removed or changed between two source versions. */
export function changedUnits(oldSource: Block[], newSource: Block[]): Set<string> {
  const before = new Map(oldSource.map((b) => [b.id, JSON.stringify(b)]));
  const after = new Map(newSource.map((b) => [b.id, JSON.stringify(b)]));
  const changed = new Set<string>();
  for (const [id, json] of after) if (before.get(id) !== json) changed.add(unitOf(id));
  for (const id of before.keys()) if (!after.has(id)) changed.add(unitOf(id));
  return changed;
}

export interface RetranslationPlan {
  /** Final block order: `source` entries are translated, `keep` entries come from the current translation. */
  plan: Array<{ kind: "source"; block: Block } | { kind: "keep"; block: Block }>;
  /** Units that will be re-translated. */
  units: string[];
}

/**
 * Plans a re-translation of `newSource` on top of the current translation: blocks of changed units
 * (or missing from the translation) are translated afresh; every other block keeps the translated
 * version, including editor edits and blocks the editor added after it. Blocks of removed units
 * disappear; order follows the new source.
 */
export function planRetranslation(
  oldSource: Block[],
  newSource: Block[],
  currentTranslation: Block[],
): RetranslationPlan {
  const changed = changedUnits(oldSource, newSource);
  const sourceIds = new Set(oldSource.map((b) => b.id));
  const targetIndex = new Map(currentTranslation.map((b, i) => [b.id, i]));
  for (const b of newSource) if (!targetIndex.has(b.id)) changed.add(unitOf(b.id));

  const plan: RetranslationPlan["plan"] = [];
  for (const block of newSource) {
    const unit = unitOf(block.id);
    if (changed.has(unit)) {
      plan.push({ kind: "source", block });
      continue;
    }
    const at = targetIndex.get(block.id)!;
    plan.push({ kind: "keep", block: currentTranslation[at]! });
    // Blocks the editor added to the translation right after this one (ids unknown to the source).
    for (let i = at + 1; i < currentTranslation.length; i++) {
      const extra = currentTranslation[i]!;
      if (sourceIds.has(extra.id) || newSource.some((b) => b.id === extra.id)) break;
      plan.push({ kind: "keep", block: extra });
    }
  }
  return { plan, units: [...changed].filter((u) => newSource.some((b) => unitOf(b.id) === u)) };
}
