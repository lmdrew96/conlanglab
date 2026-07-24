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
