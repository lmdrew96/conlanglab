import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { appendHistory, reconstructAt } from "../lib/history";
import { freshSeed } from "../lib/rng";
import { diffLexicon } from "./diff";
import { generateLexicon, regenerateSingleItem } from "./generate";
import { DEFAULT_LEXICON_PARAMS } from "./types";
import type { LexiconSnapshot } from "./diff";
import type { LexiconItemData, LexiconStageData } from "./types";
import type { PhonologyData } from "../phonology/types";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const paramsValidator = v.object({
  domainWeights: v.object({
    nautical: v.number(),
    agricultural: v.number(),
    martial: v.number(),
    mercantile: v.number(),
    pastoral: v.number(),
    craft: v.number(),
  }),
});

async function getLexiconRow(ctx: MutationCtx, languageId: Id<"languages">) {
  const row = await ctx.db
    .query("lexicon")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row) throw new Error("Lexicon not generated yet for this language");
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
    .query("lexiconItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();
}

function snapshotOf(items: LexiconItemData[], stage: LexiconStageData): LexiconSnapshot {
  return { items, params: stage.params, seed: stage.seed };
}

/**
 * Sync a freshly-generated `items` array back onto the per-item table:
 * targeted patches for existing concepts, inserts for newly-selected
 * flexible concepts, deletes for ones that fell out of this round's
 * domain-weighted selection (Section 10.1 — targeted writes, not a
 * table-wide rewrite). `staleSince` is preserved only for items carried
 * through untouched (referential equality — `generateLexicon` returns the
 * exact same object for locked/nudge-kept items); anything actually
 * regenerated is by definition current again.
 */
async function writeCollection(
  ctx: MutationCtx,
  args: {
    languageId: Id<"languages">;
    lexiconId: Id<"lexicon">;
    itemRows: Array<Doc<"lexiconItems">>;
    items: LexiconItemData[];
    stageData: LexiconStageData;
  },
): Promise<void> {
  const rowByConcept = new Map(args.itemRows.map((r) => [r.conceptId, r]));
  const nextIds = new Set(args.items.map((i) => i.id));

  for (const item of args.items) {
    const row = rowByConcept.get(item.id);
    if (row) {
      const unchanged = row.data === item;
      await ctx.db.patch(row._id, { data: item, locked: item.locked, staleSince: unchanged ? row.staleSince : null });
    } else {
      await ctx.db.insert("lexiconItems", {
        languageId: args.languageId,
        lexiconId: args.lexiconId,
        conceptId: item.id,
        data: item,
        locked: item.locked,
        staleSince: null,
      });
    }
  }
  for (const row of args.itemRows) {
    if (!nextIds.has(row.conceptId)) await ctx.db.delete(row._id);
  }

  await ctx.db.patch(args.lexiconId, { data: args.stageData });
}

export const generateInitial = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const existing = await ctx.db
      .query("lexicon")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
    if (existing) throw new Error("Lexicon already exists for this language — use reroll instead");

    const phonology = await getPhonologyData(ctx, languageId);
    const seed = { base: freshSeed(), variation: 0 };
    const { stage, items } = generateLexicon({
      seed,
      params: params ?? DEFAULT_LEXICON_PARAMS,
      phonology,
      previousItems: [],
      mode: "initial",
      now: Date.now(),
    });

    const lexiconId = await ctx.db.insert("lexicon", { languageId, data: stage, locked: false, staleSince: null });
    for (const item of items) {
      await ctx.db.insert("lexiconItems", {
        languageId,
        lexiconId,
        conceptId: item.id,
        data: item,
        locked: false,
        staleSince: null,
      });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(items, stage),
      trigger: "reroll",
      diffFn: diffLexicon,
    });
  },
});

export const reroll = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const previousItems = itemRows.map((r) => r.data as LexiconItemData);
    const previousStage = stageRow.data as LexiconStageData;

    const seed = { base: freshSeed(), variation: 0 };
    const { stage, items } = generateLexicon({
      seed,
      params: params ?? previousStage.params,
      phonology,
      previousItems,
      mode: "reroll",
      now: Date.now(),
    });

    await writeCollection(ctx, { languageId, lexiconId: stageRow._id, itemRows, items, stageData: stage });
    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(items, stage),
      trigger: "reroll",
      diffFn: diffLexicon,
    });
  },
});

export const nudge = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const previousItems = itemRows.map((r) => r.data as LexiconItemData);
    const previousStage = stageRow.data as LexiconStageData;

    const seed = { base: previousStage.seed.base, variation: previousStage.seed.variation + 1 };
    const { stage, items } = generateLexicon({
      seed,
      params: params ?? previousStage.params,
      phonology,
      previousItems,
      mode: "nudge",
      now: Date.now(),
    });

    await writeCollection(ctx, { languageId, lexiconId: stageRow._id, itemRows, items, stageData: stage });
    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(items, stage),
      trigger: "nudge",
      diffFn: diffLexicon,
    });
  },
});

export const regenerateItem = mutation({
  args: { languageId: v.id("languages"), conceptId: v.string(), mode: v.union(v.literal("nudge"), v.literal("reroll")) },
  handler: async (ctx, { languageId, conceptId, mode }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const itemRow = await ctx.db
      .query("lexiconItems")
      .withIndex("by_language_concept", (q) => q.eq("languageId", languageId).eq("conceptId", conceptId))
      .unique();
    if (!itemRow) throw new Error("Root not found");
    if (itemRow.locked) throw new Error("Root is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const allItemRows = await listItemRows(ctx, languageId);
    const allItems = allItemRows.map((r) => r.data as LexiconItemData);
    const previous = itemRow.data as LexiconItemData;

    const updated = regenerateSingleItem({
      conceptId,
      phonology,
      previous,
      allItems,
      mode,
      freshSeedBase: mode === "reroll" ? freshSeed() : undefined,
    });
    if (updated.length === 0) return;

    const rowByConcept = new Map(allItemRows.map((r) => [r.conceptId, r]));
    for (const item of updated) {
      const row = rowByConcept.get(item.id);
      if (row) await ctx.db.patch(row._id, { data: item, staleSince: null });
    }

    const nextItems = allItems.map((i) => updated.find((u) => u.id === i.id) ?? i);
    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(nextItems, stageRow.data as LexiconStageData),
      trigger: mode,
      diffFn: diffLexicon,
    });
  },
});

export const regenerateStale = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const phonology = await getPhonologyData(ctx, languageId);
    const itemRows = await listItemRows(ctx, languageId);
    const staleRows = itemRows.filter((r) => r.staleSince != null && !r.locked);
    if (staleRows.length === 0) return;

    let allItems = itemRows.map((r) => r.data as LexiconItemData);
    const rowByConcept = new Map(itemRows.map((r) => [r.conceptId, r]));

    for (const row of staleRows) {
      const previous = row.data as LexiconItemData;
      const updated = regenerateSingleItem({
        conceptId: row.conceptId,
        phonology,
        previous,
        allItems,
        mode: "reroll",
        freshSeedBase: freshSeed(),
      });
      for (const item of updated) {
        allItems = allItems.map((i) => (i.id === item.id ? item : i));
        const r = rowByConcept.get(item.id);
        if (r) await ctx.db.patch(r._id, { data: item, staleSince: null });
      }
    }

    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(allItems, stageRow.data as LexiconStageData),
      trigger: "edit",
      diffFn: diffLexicon,
    });
  },
});

export const toggleItemLock = mutation({
  args: { languageId: v.id("languages"), conceptId: v.string(), locked: v.boolean() },
  handler: async (ctx, { languageId, conceptId, locked }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const itemRow = await ctx.db
      .query("lexiconItems")
      .withIndex("by_language_concept", (q) => q.eq("languageId", languageId).eq("conceptId", conceptId))
      .unique();
    if (!itemRow) throw new Error("Root not found");

    const data = { ...(itemRow.data as LexiconItemData), locked };
    await ctx.db.patch(itemRow._id, { locked, data });

    const allItemRows = await listItemRows(ctx, languageId);
    const allItems = allItemRows.map((r) => r.data as LexiconItemData);
    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(allItems, stageRow.data as LexiconStageData),
      trigger: "edit",
      diffFn: diffLexicon,
    });
  },
});

export const lockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    await ctx.db.patch(stageRow._id, { locked: true });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, lexicon: true }, updatedAt: Date.now() });
    }

    const itemRows = await listItemRows(ctx, languageId);
    const allItems = itemRows.map((r) => r.data as LexiconItemData);
    await appendHistory(ctx, {
      languageId,
      stage: "lexicon",
      data: snapshotOf(allItems, stageRow.data as LexiconStageData),
      trigger: "edit",
      diffFn: diffLexicon,
      forceSnapshot: true,
    });
  },
});

export const unlockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    await ctx.db.patch(stageRow._id, { locked: false });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, lexicon: false }, updatedAt: Date.now() });
    }
  },
});

export const revertToHistoryEntry = mutation({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    const stageRow = await getLexiconRow(ctx, languageId);
    if (stageRow.locked) throw new Error("Lexicon stage is locked");

    const reconstructed = await reconstructAt<LexiconSnapshot>(ctx, { languageId, stage: "lexicon", historyEntryId });
    const itemRows = await listItemRows(ctx, languageId);

    const nextStage: LexiconStageData = {
      version: 1,
      seed: reconstructed.seed,
      params: reconstructed.params,
      itemCount: reconstructed.items.length,
      generatedAt: Date.now(),
    };

    await writeCollection(ctx, {
      languageId,
      lexiconId: stageRow._id,
      itemRows,
      items: reconstructed.items,
      stageData: nextStage,
    });
    await appendHistory(ctx, { languageId, stage: "lexicon", data: reconstructed, trigger: "edit", diffFn: diffLexicon });
  },
});
