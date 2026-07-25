// Cross-stage staleness (design doc Section 10.2a): when an upstream
// Phonology edit removes a phoneme, only the specific roots that used it
// get flagged — not a blanket flag on the whole lexicon. Called from
// convex/phonology/mutations.ts, the one place that knows an inventory
// actually changed; lexicon has no reason to poll phonology on its own.

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { LexiconItemData } from "./types";

export async function flagStaleLexiconItems(
  ctx: MutationCtx,
  languageId: Id<"languages">,
  currentPhonemeIds: Set<string>,
): Promise<void> {
  const items = await ctx.db
    .query("lexiconItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();

  const now = Date.now();
  for (const row of items) {
    if (row.locked || row.staleSince != null) continue;
    const data = row.data as LexiconItemData | undefined;
    if (!data) continue;
    const stale = data.phonemeIds.some((id) => !currentPhonemeIds.has(id));
    if (stale) await ctx.db.patch(row._id, { staleSince: now });
  }
}

/**
 * Section 5.5's word families depend on a source root's phonological form
 * without a same-stage cascade the way compounds get (see
 * lexicon/generate.ts's derivation-pass comment and the plan's scope
 * decision) — a root regenerating one-off via item-level nudge/reroll
 * wouldn't otherwise touch its derived items. `sourceSeed` stored on
 * `derivedFrom` at build time lets this be a cheap comparison (seed
 * changed = content changed, the same idiom used everywhere else) instead
 * of a full dependency graph. Only checks the source ROOT's seed, not the
 * source AFFIX's — a derivational affix only changes via a full Morphology
 * stage reroll/nudge in v1 (no item-level regenerate exists for them), a
 * deliberately accepted narrower gap for now.
 */
export async function flagStaleDerivedItems(ctx: MutationCtx, languageId: Id<"languages">): Promise<void> {
  const items = await ctx.db
    .query("lexiconItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();

  const byConceptId = new Map(items.map((row) => [(row.data as LexiconItemData | undefined)?.id, row]));
  const now = Date.now();
  for (const row of items) {
    if (row.locked || row.staleSince != null) continue;
    const data = row.data as LexiconItemData | undefined;
    if (!data?.derivedFrom) continue;
    const source = byConceptId.get(data.derivedFrom.conceptId)?.data as LexiconItemData | undefined;
    const seedChanged =
      !source ||
      source.seed.base !== data.derivedFrom.sourceSeed.base ||
      source.seed.variation !== data.derivedFrom.sourceSeed.variation;
    if (seedChanged) await ctx.db.patch(row._id, { staleSince: now });
  }
}
