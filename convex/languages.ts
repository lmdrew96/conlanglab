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
