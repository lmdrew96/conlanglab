import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireLanguageOwner } from "../lib/auth";
import { reconstructAt } from "../lib/history";
import type { MorphologySnapshot } from "./diff";

const HISTORY_LIST_LIMIT = 100;

export const get = query({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    return await ctx.db
      .query("morphology")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .unique();
  },
});

export const listItems = query({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    return await ctx.db
      .query("morphologyItems")
      .withIndex("by_language", (q) => q.eq("languageId", languageId))
      .collect();
  },
});

export const historyList = query({
  args: { languageId: v.id("languages") },
  handler: async (ctx, { languageId }) => {
    await requireLanguageOwner(ctx, languageId);
    const entries = await ctx.db
      .query("stageHistory")
      .withIndex("by_language_stage", (q) => q.eq("languageId", languageId).eq("stage", "morphology"))
      .order("desc")
      .take(HISTORY_LIST_LIMIT);
    return entries.map((e) => ({ _id: e._id, kind: e.kind, trigger: e.trigger, seq: e.seq, createdAt: e.createdAt }));
  },
});

export const historyEntry = query({
  args: { languageId: v.id("languages"), historyEntryId: v.id("stageHistory") },
  handler: async (ctx, { languageId, historyEntryId }) => {
    await requireLanguageOwner(ctx, languageId);
    return await reconstructAt<MorphologySnapshot>(ctx, { languageId, stage: "morphology", historyEntryId });
  },
});
