import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { appendHistory, reconstructAt } from "../lib/history";
import { Rng, deriveSeed, freshSeed } from "../lib/rng";
import { diffSyntax } from "./diff";
import { derivePhraseStructure, generateSyntax } from "./generate";
import { DEFAULT_SYNTAX_PARAMS } from "./types";
import type { Seed, SyntaxParams, SyntaxStageData } from "./types";
import type { MorphologyStageData } from "../morphology/types";
import type { LexiconItemData } from "../lexicon/types";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const wordOrderValidator = v.union(
  v.literal("SOV"),
  v.literal("SVO"),
  v.literal("VSO"),
  v.literal("VOS"),
  v.literal("OVS"),
  v.literal("OSV"),
);

const paramsValidator = v.object({ wordOrder: wordOrderValidator });

async function getSyntaxRow(ctx: MutationCtx, languageId: Id<"languages">) {
  const row = await ctx.db
    .query("syntax")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row) throw new Error("Syntax not generated yet for this language");
  return row;
}

/** Syntax requires Morphology's typology + selected categories to lean word order (Section 7.1) — Morphology (M3/M4) generates before Syntax in the pipeline (roadmap §15), so this is a hard requirement, not a graceful-degradation lookup like Morphology's own getLexiconItems. */
async function getMorphologyStageData(ctx: MutationCtx, languageId: Id<"languages">): Promise<MorphologyStageData> {
  const row = await ctx.db
    .query("morphology")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row || !row.data) throw new Error("Generate morphology first");
  return row.data as MorphologyStageData;
}

async function getLexiconItems(ctx: MutationCtx, languageId: Id<"languages">): Promise<LexiconItemData[]> {
  const rows = await ctx.db
    .query("lexiconItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();
  return rows.map((r) => r.data as LexiconItemData).filter(Boolean);
}

/** Same "same base = same stream, nudge derives a fresh but deterministic stream" idiom convex/phonology/generate.ts's Rng-seeding uses — variation is 0 exactly when the seed hasn't been nudged since its last reroll. */
function seedRngFrom(seed: Seed): Rng {
  return new Rng(seed.variation > 0 ? deriveSeed(seed.base, seed.variation) : seed.base);
}

export const generateInitial = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const existing = await ctx.db
      .query("syntax")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
    if (existing) throw new Error("Syntax already exists for this language — use reroll instead");

    const morphology = await getMorphologyStageData(ctx, languageId);
    const lexiconItems = await getLexiconItems(ctx, languageId);
    const seed = { base: freshSeed(), variation: 0 };
    const data = generateSyntax({
      seed,
      params: params ?? DEFAULT_SYNTAX_PARAMS,
      morphology,
      lexiconItems,
      mode: "initial",
      now: Date.now(),
    });

    await ctx.db.insert("syntax", { languageId, data, locked: false, staleSince: null });
    await appendHistory(ctx, { languageId, stage: "syntax", data, trigger: "reroll", diffFn: diffSyntax });
  },
});

export const reroll = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    if (row.locked) throw new Error("Syntax stage is locked");

    const previous = row.data as SyntaxStageData;
    const morphology = await getMorphologyStageData(ctx, languageId);
    const lexiconItems = await getLexiconItems(ctx, languageId);
    const seed = { base: freshSeed(), variation: 0 };
    const data = generateSyntax({
      seed,
      params: params ?? previous.params,
      morphology,
      lexiconItems,
      mode: "reroll",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "syntax", data, trigger: "reroll", diffFn: diffSyntax });
  },
});

export const nudge = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    if (row.locked) throw new Error("Syntax stage is locked");

    const previous = row.data as SyntaxStageData;
    const morphology = await getMorphologyStageData(ctx, languageId);
    const lexiconItems = await getLexiconItems(ctx, languageId);
    const seed = { base: previous.seed.base, variation: previous.seed.variation + 1 };
    const data = generateSyntax({
      seed,
      params: params ?? previous.params,
      morphology,
      lexiconItems,
      mode: "nudge",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "syntax", data, trigger: "nudge", diffFn: diffSyntax });
  },
});

/**
 * Direct user override, not an algorithmic regeneration — same rationale as
 * convex/phonology/mutations.ts's setStressPattern. Recomputes
 * phraseStructure from the SAME seed (no fresh entropy) since it's a
 * deterministic function of (wordOrder, seed) — see types.ts's
 * PhraseStructureData comment — and deliberately leaves exampleConcepts
 * untouched, so picking a different word order doesn't also reroll the
 * example words.
 */
export const setWordOrder = mutation({
  args: { languageId: v.id("languages"), wordOrder: wordOrderValidator },
  handler: async (ctx, { languageId, wordOrder }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    if (row.locked) throw new Error("Syntax stage is locked");

    const previous = row.data as SyntaxStageData;
    const rng = seedRngFrom(previous.seed);
    const phraseStructure = derivePhraseStructure(wordOrder, rng);
    const params: SyntaxParams = { wordOrder };
    const data: SyntaxStageData = { ...previous, params, phraseStructure };

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "syntax", data, trigger: "edit", diffFn: diffSyntax });
  },
});

export const lockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: true });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, syntax: true }, updatedAt: Date.now() });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "syntax",
      data: row.data as SyntaxStageData,
      trigger: "edit",
      diffFn: diffSyntax,
      forceSnapshot: true,
    });
  },
});

export const unlockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: false });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, { lockedStages: { ...language.lockedStages, syntax: false }, updatedAt: Date.now() });
    }
  },
});

export const revertToHistoryEntry = mutation({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getSyntaxRow(ctx, languageId);
    if (row.locked) throw new Error("Syntax stage is locked");

    const reconstructed = await reconstructAt<SyntaxStageData>(ctx, { languageId, stage: "syntax", historyEntryId });

    await ctx.db.patch(row._id, { data: reconstructed });
    await appendHistory(ctx, { languageId, stage: "syntax", data: reconstructed, trigger: "edit", diffFn: diffSyntax });
  },
});
