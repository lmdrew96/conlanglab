import type { Id } from "../_generated/dataModel";

interface AuthCtx {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
}

export async function requireUserId(ctx: AuthCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

interface DbCtx extends AuthCtx {
  db: {
    get: (id: Id<"languages">) => Promise<{ owner: string } | null>;
  };
}

/**
 * Every stage (phonology, lexicon, ...) references a parent `languages`
 * document but has no `owner` field of its own — ownership is always
 * checked by looking up the parent. Shared here since every stage's
 * mutations/queries need this same check.
 */
export async function requireLanguageOwner(ctx: DbCtx, languageId: Id<"languages">): Promise<string> {
  const userId = await requireUserId(ctx);
  const language = await ctx.db.get(languageId);
  if (!language || language.owner !== userId) throw new Error("Not found");
  return userId;
}
