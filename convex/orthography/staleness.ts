// Cross-stage staleness (design doc Section 10.2a). Orthography is a
// "single coherent object" stage (Section 10.1/10.2 — one document, no
// items table), so unlike lexicon/staleness.ts's per-root flagging, both
// helpers here flag the WHOLE row at once — there's no finer-grained unit
// to target. Called from convex/phonology/mutations.ts and
// convex/lexicon/mutations.ts, the two places that know an upstream edit
// actually happened; orthography has no reason to poll either on its own.

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { OrthographyStageData } from "./types";

async function getOrthographyRow(ctx: MutationCtx, languageId: Id<"languages">) {
  return await ctx.db
    .query("orthography")
    .withIndex("by_language", (q) => q.eq("languageId", languageId))
    .unique();
}

/**
 * Every phoneme id this language's current mapping actually references,
 * regardless of script category. Includes `rules`' phonemeIds — a digraph-
 * overflow phoneme has no entry in the base map at all (only a rule), so
 * skipping `rules` here would silently miss a Phonology edit to that
 * phoneme and never flag this stage stale. `rules` defaults to [] since a
 * mapping generated before v2 added the field won't have it in storage at
 * all (Convex stores `data` as `v.any()` — no schema migration backfills
 * old documents), not just an empty array.
 */
function referencedPhonemeIds(mapping: OrthographyStageData["mapping"]): string[] {
  switch (mapping.kind) {
    case "alphabetic":
      return [...Object.keys(mapping.phonemeToGlyph), ...(mapping.rules ?? []).map((r) => r.phonemeId)];
    case "abjad":
      return [...Object.keys(mapping.consonantToGlyph), ...(mapping.rules ?? []).map((r) => r.phonemeId)];
    case "abugida":
      return [
        ...Object.keys(mapping.baseConsonantToGlyph),
        ...Object.keys(mapping.vowelToDiacritic),
        ...(mapping.rules ?? []).map((r) => r.phonemeId),
      ];
    case "syllabic":
      return Object.keys(mapping.syllableToGlyph).flatMap((key) => {
        const [consonantId, vowelId] = key.split("+");
        return consonantId === "_" ? [vowelId] : [consonantId, vowelId];
      });
    case "logographic":
      return [];
  }
}

/** Skipped for logographic mappings — they have no phoneme keys at all, so a Phonology edit can never affect them. */
export async function flagStaleOrthographyForPhonology(
  ctx: MutationCtx,
  languageId: Id<"languages">,
  currentPhonemeIds: Set<string>,
): Promise<void> {
  const row = await getOrthographyRow(ctx, languageId);
  if (!row || row.locked || row.staleSince != null) return;
  const data = row.data as OrthographyStageData | undefined;
  if (!data) return;

  const referenced = referencedPhonemeIds(data.mapping);
  const stale = referenced.some((id) => !currentPhonemeIds.has(id));
  if (stale) await ctx.db.patch(row._id, { staleSince: Date.now() });
}

/** Only relevant for the syllabic (attested-syllable) and logographic (per-concept) categories — alphabetic/abjad/abugida mappings don't read Lexicon at all. */
export async function flagStaleOrthographyForLexicon(ctx: MutationCtx, languageId: Id<"languages">): Promise<void> {
  const row = await getOrthographyRow(ctx, languageId);
  if (!row || row.locked || row.staleSince != null) return;
  const data = row.data as OrthographyStageData | undefined;
  if (!data) return;
  if (data.mapping.kind !== "syllabic" && data.mapping.kind !== "logographic") return;

  await ctx.db.patch(row._id, { staleSince: Date.now() });
}
