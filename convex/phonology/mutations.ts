import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { appendHistory, reconstructAt } from "../lib/history";
import { freshSeed } from "../lib/rng";
// Cross-stage staleness (Section 10.2a) — only this file knows when an
// inventory edit actually happened, so it's the one place that flags
// downstream lexicon roots stale rather than lexicon polling phonology.
import { flagStaleLexiconItems } from "../lexicon/staleness";
import { diffPhonology } from "./diff";
import { generatePhonology } from "./generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "./types";
import type { PhonologyData, PhonologyTarget } from "./types";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

function currentPhonemeIds(data: PhonologyData): Set<string> {
  return new Set([...data.consonants.map((c) => c.id), ...data.vowels.map((v) => v.id)]);
}

const targetValidator = v.union(
  v.literal("inventory"),
  v.literal("phonotactics"),
  v.literal("sonorityGrading"),
  v.literal("stress"),
  v.literal("tone"),
  v.literal("all"),
);

const paramsValidator = v.object({
  consonantInventorySize: v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
  vowelInventorySize: v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
  markedFeatures: v.object({
    ejectives: v.boolean(),
    clicks: v.boolean(),
    frontRoundedVowels: v.boolean(),
    implosives: v.boolean(),
  }),
  typologicalStrictness: v.number(),
  clusterComplexity: v.number(),
  sonorityViolationRate: v.number(),
});

const lockableFieldValidator = v.union(
  v.literal("phonotactics"),
  v.literal("sonorityGrading"),
  v.literal("stress"),
  v.literal("tone"),
);

function resolveTargets(target: PhonologyTarget | "all"): PhonologyTarget[] {
  return target === "all" ? ALL_TARGETS : [target];
}

async function getPhonologyRow(ctx: MutationCtx, languageId: Id<"languages">) {
  const row = await ctx.db
    .query("phonology")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
  if (!row) throw new Error("Phonology not generated yet for this language");
  return row;
}

export const generateInitial = mutation({
  args: { languageId: v.id("languages"), params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const existing = await ctx.db
      .query("phonology")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
    if (existing) throw new Error("Phonology already exists for this language — use reroll instead");

    const seed = { base: freshSeed(), variation: 0 };
    const data = generatePhonology({
      seed,
      params: params ?? DEFAULT_PARAMS,
      previous: null,
      targets: ALL_TARGETS,
      mode: "initial",
      now: Date.now(),
    });

    await ctx.db.insert("phonology", { languageId, data, locked: false, staleSince: null });
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "reroll", diffFn: diffPhonology });
  },
});

export const reroll = mutation({
  args: { languageId: v.id("languages"), target: targetValidator, params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, target, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    const targets = resolveTargets(target);
    const data = generatePhonology({
      seed: { base: freshSeed(), variation: 0 },
      params: params ?? previous.params,
      previous,
      targets,
      mode: "reroll",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    if (targets.includes("inventory")) await flagStaleLexiconItems(ctx, languageId, currentPhonemeIds(data));
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "reroll", diffFn: diffPhonology });
  },
});

export const nudge = mutation({
  args: { languageId: v.id("languages"), target: targetValidator, params: v.optional(paramsValidator) },
  handler: async (ctx, { languageId, target, params }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    const targets = resolveTargets(target);
    const data = generatePhonology({
      seed: { base: previous.seed.base, variation: previous.seed.variation + 1 },
      params: params ?? previous.params,
      previous,
      targets,
      mode: "nudge",
      now: Date.now(),
    });

    await ctx.db.patch(row._id, { data });
    if (targets.includes("inventory")) await flagStaleLexiconItems(ctx, languageId, currentPhonemeIds(data));
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "nudge", diffFn: diffPhonology });
  },
});

export const togglePhonemeLock = mutation({
  args: {
    languageId: v.id("languages"),
    kind: v.union(v.literal("consonant"), v.literal("vowel")),
    phonemeId: v.string(),
    locked: v.boolean(),
  },
  handler: async (ctx, { languageId, kind, phonemeId, locked }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    const data: PhonologyData =
      kind === "consonant"
        ? {
            ...previous,
            consonants: previous.consonants.map((p) => (p.id === phonemeId ? { ...p, locked } : p)),
          }
        : {
            ...previous,
            vowels: previous.vowels.map((p) => (p.id === phonemeId ? { ...p, locked } : p)),
          };

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "edit", diffFn: diffPhonology });
  },
});

export const toggleFieldLock = mutation({
  args: { languageId: v.id("languages"), field: lockableFieldValidator, locked: v.boolean() },
  handler: async (ctx, { languageId, field, locked }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    let data: PhonologyData;
    switch (field) {
      case "phonotactics":
        data = { ...previous, phonotactics: { ...previous.phonotactics, locked } };
        break;
      case "sonorityGrading":
        data = { ...previous, sonorityGrading: { ...previous.sonorityGrading, locked } };
        break;
      case "stress":
        data = { ...previous, stress: { ...previous.stress, locked } };
        break;
      case "tone":
        data = { ...previous, tone: { ...previous.tone, locked } };
        break;
    }

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "edit", diffFn: diffPhonology });
  },
});

const stressPatternValidator = v.union(
  v.literal("initial"),
  v.literal("final"),
  v.literal("penultimate"),
  v.literal("weightSensitive"),
  v.literal("none"),
);

/**
 * Direct user override, not an algorithmic regeneration — Section 4.4:
 * "user selects (or the system proposes, then user can override)". Distinct
 * from `nudge`/`reroll("stress")`, which pick a pattern via the weighted
 * random build function instead of a specific user choice.
 */
export const setStressPattern = mutation({
  args: { languageId: v.id("languages"), pattern: stressPatternValidator },
  handler: async (ctx, { languageId, pattern }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    const data: PhonologyData = { ...previous, stress: { ...previous.stress, pattern } };

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "edit", diffFn: diffPhonology });
  },
});

/** Direct user override of tone configuration — same rationale as setStressPattern. */
export const setTone = mutation({
  args: {
    languageId: v.id("languages"),
    enabled: v.boolean(),
    levels: v.number(),
    contours: v.boolean(),
  },
  handler: async (ctx, { languageId, enabled, levels, contours }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const previous = row.data as PhonologyData;
    const data: PhonologyData = { ...previous, tone: { ...previous.tone, enabled, levels, contours } };

    await ctx.db.patch(row._id, { data });
    await appendHistory(ctx, { languageId, stage: "phonology", data, trigger: "edit", diffFn: diffPhonology });
  },
});

export const lockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: true });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, {
        lockedStages: { ...language.lockedStages, phonology: true },
        updatedAt: Date.now(),
      });
    }

    await appendHistory(ctx, {
      languageId,
      stage: "phonology",
      data: row.data as PhonologyData,
      trigger: "edit",
      diffFn: diffPhonology,
      forceSnapshot: true,
    });
  },
});

export const unlockStage = mutation({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    await ctx.db.patch(row._id, { locked: false });

    const language = await ctx.db.get(languageId);
    if (language) {
      await ctx.db.patch(languageId, {
        lockedStages: { ...language.lockedStages, phonology: false },
        updatedAt: Date.now(),
      });
    }
  },
});

export const revertToHistoryEntry = mutation({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    const row = await getPhonologyRow(ctx, languageId);
    if (row.locked) throw new Error("Phonology stage is locked");

    const reconstructed = await reconstructAt<PhonologyData>(ctx, {
      languageId,
      stage: "phonology",
      historyEntryId,
    });

    await ctx.db.patch(row._id, { data: reconstructed });
    // A revert can restore an older inventory that dropped phonemes newer
    // roots depend on — always re-check, unlike reroll/nudge which only
    // check when the "inventory" target was actually in play.
    await flagStaleLexiconItems(ctx, languageId, currentPhonemeIds(reconstructed));
    await appendHistory(ctx, {
      languageId,
      stage: "phonology",
      data: reconstructed,
      trigger: "edit",
      diffFn: diffPhonology,
    });
  },
});
