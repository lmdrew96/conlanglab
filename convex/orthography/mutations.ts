import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { appendHistory, reconstructAt } from "../lib/history";
import { freshSeed } from "../lib/rng";
import { diffOrthography } from "./diff";
import { generateOrthography } from "./generate";
import { DEFAULT_ORTHOGRAPHY_PARAMS } from "./types";
import type { OrthographyParams, OrthographyStageData } from "./types";
import type { PhonologyData } from "../phonology/types";
import type { LexiconItemData } from "../lexicon/types";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const scriptCategoryValidator = v.union(
  v.literal("alphabetic"),
  v.literal("abjad"),
  v.literal("abugida"),
  v.literal("syllabic"),
  v.literal("logographic"),
);
const aestheticValidator = v.union(v.literal("invented"), v.literal("realLike"));
const ancestorScriptValidator = v.union(
  v.literal("latin"),
  v.literal("cyrillic"),
  v.literal("arabic"),
  v.literal("devanagari"),
  v.literal("hangul"),
  v.null(),
);
const overflowStrategyValidator = v.union(v.literal("digraph"), v.literal("diacriticStacking"), v.literal("extendedInventory"));
const paramsValidator = v.object({
  scriptCategory: scriptCategoryValidator,
  aesthetic: aestheticValidator,
  orthographicDepth: v.number(),
  ancestorScript: ancestorScriptValidator,
  overflowStrategy: overflowStrategyValidator,
});

async function getOrthographyRow(ctx: MutationCtx, languageId: Id<"languages">) {
  const row = await ctx.db
    .query("orthography")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row) throw new Error("Orthography not generated yet for this language");
  return row;
}

/** Orthography requires Phonology's sound inventory to map onto symbols (Section 8.1) — Phonology (M1/M2) generates before Orthography in the pipeline (roadmap §15), so this is a hard requirement, not a graceful-degradation lookup. */
async function getPhonologyData(ctx: MutationCtx, languageId: Id<"languages">): Promise<PhonologyData> {
  const row = await ctx.db
    .query("phonology")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row || !row.data) throw new Error("Generate phonology first");
  return row.data as PhonologyData;
}

/** Only fetched when the effective script category actually reads Lexicon (syllabic/logographic, Section 8.1's amended dependency) — a wasted read otherwise. */
async function getLexiconItemsIfNeeded(
  ctx: MutationCtx,
  languageId: Id<"languages">,
  category: OrthographyParams["scriptCategory"],
): Promise<LexiconItemData[]> {
  if (category !== "syllabic" && category !== "logographic") return [];
  const rows = await ctx.db
    .query("lexiconItems")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .collect();
  return rows.map((r) => r.data as LexiconItemData).filter(Boolean);
}

export const generateInitial = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const existing = await ctx.db
      .query("orthography")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
    if (existing) throw new Error("Orthography already exists for this language — use reroll instead");

    const phonology = await getPhonologyData(ctx, languageId);
    const resolvedParams = params ?? DEFAULT_ORTHOGRAPHY_PARAMS;
    const lexiconItems = await getLexiconItemsIfNeeded(ctx, languageId, resolvedParams.scriptCategory);
    const seed = { base: freshSeed(), variation: 0 };
    const data = generateOrthography({
      seed,
      params: resolvedParams,
      phonology,
      lexiconItems,
      previous: null,
      mode: "initial",
      now: Date.now(),
    });

    await ctx.db.insert("orthography", { languageId, data, locked: false, staleSince: null });
    await appendHistory(ctx, { languageId, stage: "orthography", data, trigger: "reroll", diffFn: diffOrthography });
  },
});

export const reroll = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    if (row.locked) throw new Error("Orthography stage is locked");

    const previous = row.data as OrthographyStageData;
    const phonology = await getPhonologyData(ctx, languageId);
    // A language generated before v2's depth/ancestorScript/overflowStrategy
    // fields existed has a `previous.params` missing them entirely — merge
    // over DEFAULT_ORTHOGRAPHY_PARAMS (each default is a no-op value) so an
    // old language's reroll/nudge doesn't produce `undefined` fields that
    // read as NaN in the UI or silently mis-branch the overflow-strategy
    // check in generate.ts's planWithOverflow.
    const resolvedParams = params ?? { ...DEFAULT_ORTHOGRAPHY_PARAMS, ...previous.params };
    const lexiconItems = await getLexiconItemsIfNeeded(ctx, languageId, resolvedParams.scriptCategory);
    const seed = { base: freshSeed(), variation: 0 };
    const data = generateOrthography({
      seed,
      params: resolvedParams,
      phonology,
      lexiconItems,
      previous,
      mode: "reroll",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "orthography", data, trigger: "reroll", diffFn: diffOrthography });
  },
});

export const nudge = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    if (row.locked) throw new Error("Orthography stage is locked");

    const previous = row.data as OrthographyStageData;
    const phonology = await getPhonologyData(ctx, languageId);
    // A language generated before v2's depth/ancestorScript/overflowStrategy
    // fields existed has a `previous.params` missing them entirely — merge
    // over DEFAULT_ORTHOGRAPHY_PARAMS (each default is a no-op value) so an
    // old language's reroll/nudge doesn't produce `undefined` fields that
    // read as NaN in the UI or silently mis-branch the overflow-strategy
    // check in generate.ts's planWithOverflow.
    const resolvedParams = params ?? { ...DEFAULT_ORTHOGRAPHY_PARAMS, ...previous.params };
    const lexiconItems = await getLexiconItemsIfNeeded(ctx, languageId, resolvedParams.scriptCategory);
    const seed = { base: previous.seed.base, variation: previous.seed.variation + 1 };
    const data = generateOrthography({
      seed,
      params: resolvedParams,
      phonology,
      lexiconItems,
      previous,
      mode: "nudge",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "orthography", data, trigger: "nudge", diffFn: diffOrthography });
  },
});

/**
 * Read-modify-write on the inline `glyphs` array — mirrors
 * convex/phonology/mutations.ts's togglePhonemeLock. No separate per-glyph
 * regenerate mutation: glyphs live on this one stage document (Section
 * 10.1), not their own table, so individual regeneration happens via lock +
 * the next stage-wide reroll/nudge, exactly Phonology's model for
 * individual phonemes.
 */
export const toggleGlyphLock = mutation({
  args: { languageId: v.id("languages"), glyphId: v.string(), locked: v.boolean() },
  handler: async (ctx, { languageId, glyphId, locked }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    if (row.locked) throw new Error("Orthography stage is locked");

    const previous = row.data as OrthographyStageData;
    const data: OrthographyStageData = {
      ...previous,
      glyphs: previous.glyphs.map((g) => (g.id === glyphId ? { ...g, locked } : g)),
    };

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "orthography", data, trigger: "edit", diffFn: diffOrthography });
  },
});

export const lockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: true });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, {
        lockedStages: { ...language.lockedStages, orthography: true },
        updatedAt: Date.now(),
      });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "orthography",
      data: row.data as OrthographyStageData,
      trigger: "edit",
      diffFn: diffOrthography,
      forceSnapshot: true,
    });
  },
});

export const unlockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: false });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, {
        lockedStages: { ...language.lockedStages, orthography: false },
        updatedAt: Date.now(),
      });
    }
  },
});

export const revertToHistoryEntry = mutation({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getOrthographyRow(ctx, languageId);
    if (row.locked) throw new Error("Orthography stage is locked");

    const reconstructed = await reconstructAt<OrthographyStageData>(ctx, {
      languageId,
      stage: "orthography",
      historyEntryId,
    });

    await ctx.db.patch(row._id, { data: reconstructed });
    await appendHistory(ctx, {
      languageId,
      stage: "orthography",
      data: reconstructed,
      trigger: "edit",
      diffFn: diffOrthography,
    });
  },
});
