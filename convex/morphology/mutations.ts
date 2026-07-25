import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { appendHistory, reconstructAt } from "../lib/history";
import { freshSeed } from "../lib/rng";
import { diffMorphology } from "./diff";
import { generateMorphology, regenerateSingleItem } from "./generate";
import { DEFAULT_MORPHOLOGY_PARAMS } from "./types";
import type { MorphologySnapshot } from "./diff";
import type { MorphologyAffixData, MorphologyStageData } from "./types";
import type { PhonologyData } from "../phonology/types";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const paramsValidator = v.object({
  typology: v.union(
    v.literal("isolating"),
    v.literal("agglutinative"),
    v.literal("fusional"),
    v.literal("polysynthetic"),
  ),
});

async function getMorphologyRow(ctx: MutationCtx, languageId: Id<"languages">) {
  const row = await ctx.db
    .query("morphology")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row) throw new Error("Morphology not generated yet for this language");
  return row;
}

async function getPhonologyData(ctx: MutationCtx, languageId: Id<"languages">): Promise<PhonologyData> {
  const row = await ctx.db
    .query("phonology")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row || !row.data) throw new Error("Generate phonology first");
  return row.data as PhonologyData;
}

async function listItemRows(ctx: MutationCtx, languageId: Id<"languages">) {
  return await ctx.db
    .query("morphologyItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();
}

function snapshotOf(items: MorphologyAffixData[], stage: MorphologyStageData): MorphologySnapshot {
  return { items, params: stage.params, seed: stage.seed, selectedCategories: stage.selectedCategories };
}

/**
 * Sync a freshly-generated `items` array back onto the per-item table:
 * targeted patches for existing affixes, inserts for newly-selected cells,
 * deletes for ones that fell out of this round's category selection
 * (Section 10.1 — targeted writes, not a table-wide rewrite). Exact mirror
 * of lexicon/mutations.ts's writeCollection, keyed on `affixId` instead of
 * `conceptId`.
 */
async function writeCollection(
  ctx: MutationCtx,
  args: {
    languageId: Id<"languages">;
    morphologyId: Id<"morphology">;
    itemRows: Array<Doc<"morphologyItems">>;
    items: MorphologyAffixData[];
    stageData: MorphologyStageData;
  },
): Promise<void> {
  const rowByAffix = new Map(args.itemRows.map((r) => [r.affixId, r]));
  const nextIds = new Set(args.items.map((i) => i.id));

  for (const item of args.items) {
    const row = rowByAffix.get(item.id);
    if (row) {
      const unchanged = row.data === item;
      await ctx.db.patch(row._id, { data: item, locked: item.locked, staleSince: unchanged ? row.staleSince : null });
    } else {
      await ctx.db.insert("morphologyItems", {
        languageId: args.languageId,
        morphologyId: args.morphologyId,
        affixId: item.id,
        data: item,
        locked: item.locked,
        staleSince: null,
      });
    }
  }
  for (const row of args.itemRows) {
    if (!nextIds.has(row.affixId)) await ctx.db.delete(row._id);
  }

  await ctx.db.patch(args.morphologyId, { data: args.stageData });
}

export const generateInitial = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const existing = await ctx.db
      .query("morphology")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
    if (existing) throw new Error("Morphology already exists for this language — use reroll instead");

    const phonology = await getPhonologyData(ctx, languageId);
    const seed = { base: freshSeed(), variation: 0 };
    const { stage, items } = generateMorphology({
      seed,
      params: params ?? DEFAULT_MORPHOLOGY_PARAMS,
      phonology,
      previousItems: [],
      mode: "initial",
      now: Date.now(),
    });

    const morphologyId = await ctx.db.insert("morphology", { languageId, data: stage, locked: false, staleSince: null });
    for (const item of items) {
      await ctx.db.insert("morphologyItems", {
        languageId,
        morphologyId,
        affixId: item.id,
        data: item,
        locked: false,
        staleSince: null,
      });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(items, stage),
      trigger: "reroll",
      diffFn: diffMorphology,
    });
  },
});

export const reroll = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const previousItems = itemRows.map((r) => r.data as MorphologyAffixData);
    const previousStage = stageRow.data as MorphologyStageData;

    const seed = { base: freshSeed(), variation: 0 };
    const { stage, items } = generateMorphology({
      seed,
      params: params ?? previousStage.params,
      phonology,
      previousItems,
      mode: "reroll",
      now: Date.now(),
    });

    await writeCollection(ctx, { languageId, morphologyId: stageRow._id, itemRows, items, stageData: stage });
    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(items, stage),
      trigger: "reroll",
      diffFn: diffMorphology,
    });
  },
});

export const nudge = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const previousItems = itemRows.map((r) => r.data as MorphologyAffixData);
    const previousStage = stageRow.data as MorphologyStageData;

    const seed = { base: previousStage.seed.base, variation: previousStage.seed.variation + 1 };
    const { stage, items } = generateMorphology({
      seed,
      params: params ?? previousStage.params,
      phonology,
      previousItems,
      mode: "nudge",
      now: Date.now(),
    });

    await writeCollection(ctx, { languageId, morphologyId: stageRow._id, itemRows, items, stageData: stage });
    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(items, stage),
      trigger: "nudge",
      diffFn: diffMorphology,
    });
  },
});

export const regenerateItem = mutation({
  args: { languageId: v.id("languages"), affixId: v.string(), mode: v.union(v.literal("nudge"), v.literal("reroll")) },
  handler: async (ctx, { languageId, affixId, mode }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const itemRow = await ctx.db
      .query("morphologyItems")
      .withIndex("by_language_affix", (q) => q.eq("languageId", languageId).eq("affixId", affixId))
      .unique();
    if (!itemRow) throw new Error("Affix not found");
    if (itemRow.locked) throw new Error("Affix is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const allItemRows = await listItemRows(ctx, languageId);
    const allItems = allItemRows.map((r) => r.data as MorphologyAffixData);
    const previous = itemRow.data as MorphologyAffixData;

    const updated = regenerateSingleItem({
      phonology,
      previous,
      allItems,
      mode,
      freshSeedBase: mode === "reroll" ? freshSeed() : undefined,
    });

    await ctx.db.patch(itemRow._id, { data: updated, staleSince: null });

    const nextItems = allItems.map((i) => (i.id === updated.id ? updated : i));
    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(nextItems, stageRow.data as MorphologyStageData),
      trigger: mode,
      diffFn: diffMorphology,
    });
  },
});

export const regenerateStale = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const staleRows = itemRows.filter((r) => r.staleSince != null && !r.locked);
    if (staleRows.length === 0) return;

    let allItems = itemRows.map((r) => r.data as MorphologyAffixData);
    const rowByAffix = new Map(itemRows.map((r) => [r.affixId, r]));

    for (const row of staleRows) {
      const previous = row.data as MorphologyAffixData;
      const updated = regenerateSingleItem({ phonology, previous, allItems, mode: "reroll", freshSeedBase: freshSeed() });
      allItems = allItems.map((i) => (i.id === updated.id ? updated : i));
      const r = rowByAffix.get(row.affixId);
      if (r) await ctx.db.patch(r._id, { data: updated, staleSince: null });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(allItems, stageRow.data as MorphologyStageData),
      trigger: "edit",
      diffFn: diffMorphology,
    });
  },
});

export const toggleItemLock = mutation({
  args: { languageId: v.id("languages"), affixId: v.string(), locked: v.boolean() },
  handler: async (ctx, { languageId, affixId, locked }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const itemRow = await ctx.db
      .query("morphologyItems")
      .withIndex("by_language_affix", (q) => q.eq("languageId", languageId).eq("affixId", affixId))
      .unique();
    if (!itemRow) throw new Error("Affix not found");

    const data = { ...(itemRow.data as MorphologyAffixData), locked };
    await ctx.db.patch(itemRow._id, { locked, data });

    const allItemRows = await listItemRows(ctx, languageId);
    const allItems = allItemRows.map((r) => r.data as MorphologyAffixData);
    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(allItems, stageRow.data as MorphologyStageData),
      trigger: "edit",
      diffFn: diffMorphology,
    });
  },
});

export const lockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    await ctx.db.patch(stageRow._id, { locked: true });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, morphology: true }, updatedAt: Date.now() });
    }

    const itemRows = await listItemRows(ctx, languageId);
    const allItems = itemRows.map((r) => r.data as MorphologyAffixData);
    await appendHistory(ctx, {
      languageId,
      stage: "morphology",
      data: snapshotOf(allItems, stageRow.data as MorphologyStageData),
      trigger: "edit",
      diffFn: diffMorphology,
      forceSnapshot: true,
    });
  },
});

export const unlockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    await ctx.db.patch(stageRow._id, { locked: false });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, morphology: false }, updatedAt: Date.now() });
    }
  },
});

export const revertToHistoryEntry = mutation({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getMorphologyRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Morphology stage is locked");

    const reconstructed = await reconstructAt<MorphologySnapshot>(ctx, { languageId, stage: "morphology", historyEntryId });
    const itemRows = await listItemRows(ctx, languageId);

    const nextStage: MorphologyStageData = {
      version: 1,
      seed: reconstructed.seed,
      params: reconstructed.params,
      selectedCategories: reconstructed.selectedCategories,
      affixCount: reconstructed.items.length,
      generatedAt: Date.now(),
    };

    await writeCollection(ctx, {
      languageId,
      morphologyId: stageRow._id,
      itemRows,
      items: reconstructed.items,
      stageData: nextStage,
    });
    await appendHistory(ctx, { languageId, stage: "morphology", data: reconstructed, trigger: "edit", diffFn: diffMorphology });
  },
});
