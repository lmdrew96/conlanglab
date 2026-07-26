import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("languages")
      .withIndex("by_owner", (q) => q.eq("owner", userId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("languages") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const language = await ctx.db.get(id);
    if (!language || language.owner !== userId) return null;
    return language;
  },
});

// Per-stage "is anything in this stage stale" for the library/detail list
// badge (design doc Section 10.2a). Item-collection stages (lexicon,
// morphology) are stale if the stage doc itself or any individual item is
// flagged; single-document stages (phonology, syntax, orthography) just
// read the stage doc's own staleSince.
export const getStageStaleness = query({
  args: { id: v.id("languages") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const language = await ctx.db.get(id);
    if (!language || language.owner !== userId) return null;

    const [phonologyRow, lexiconRow, lexiconItems, morphologyRow, morphologyItems, syntaxRow, orthographyRow] =
      await Promise.all([
        ctx.db.query("phonology").withIndex("by_language", (q) => q.eq("languageId", id)).unique(),
        ctx.db.query("lexicon").withIndex("by_language", (q) => q.eq("languageId", id)).unique(),
        ctx.db.query("lexiconItems").withIndex("by_language", (q) => q.eq("languageId", id)).collect(),
        ctx.db.query("morphology").withIndex("by_language", (q) => q.eq("languageId", id)).unique(),
        ctx.db.query("morphologyItems").withIndex("by_language", (q) => q.eq("languageId", id)).collect(),
        ctx.db.query("syntax").withIndex("by_language", (q) => q.eq("languageId", id)).unique(),
        ctx.db.query("orthography").withIndex("by_language", (q) => q.eq("languageId", id)).unique(),
      ]);

    return {
      phonology: phonologyRow?.staleSince != null,
      lexicon: lexiconRow?.staleSince != null || lexiconItems.some((item) => item.staleSince != null),
      morphology: morphologyRow?.staleSince != null || morphologyItems.some((item) => item.staleSince != null),
      syntax: syntaxRow?.staleSince != null,
      orthography: orthographyRow?.staleSince != null,
    };
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    return await ctx.db.insert("languages", {
      owner: userId,
      name,
      visibility: "private",
      lockedStages: {
        phonology: false,
        lexicon: false,
        morphology: false,
        syntax: false,
        orthography: false,
      },
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { id: v.id("languages"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await requireUserId(ctx);
    const language = await ctx.db.get(id);
    if (!language || language.owner !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { name, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("languages") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const language = await ctx.db.get(id);
    if (!language || language.owner !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
