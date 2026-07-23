import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Section 10.2: stage documents share this shape — a lock flag (Section 9.1
// stage-level locking) and a staleSince timestamp (Section 10.2a; null when
// current). The generated data itself is `v.any()` because each engine's
// concrete data shape is designed in its own milestone (M1 phonology, M3/M4
// morphology, M5 syntax, M6 orthography) — this table only needs to exist
// now so locking/staleness/history can be wired against it.

const visibility = v.union(
  v.literal("private"),
  v.literal("shared"),
  v.literal("public"),
);

const stageName = v.union(
  v.literal("phonology"),
  v.literal("lexicon"),
  v.literal("morphology"),
  v.literal("syntax"),
  v.literal("orthography"),
);

export default defineSchema({
  languages: defineTable({
    owner: v.string(), // Clerk user id
    name: v.string(),
    visibility,
    // Denormalized per-stage lock flags so the library UI can render lock
    // badges without joining every stage table (Section 10.2).
    lockedStages: v.object({
      phonology: v.boolean(),
      lexicon: v.boolean(),
      morphology: v.boolean(),
      syntax: v.boolean(),
      orthography: v.boolean(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["owner"]),

  phonology: defineTable({
    languageId: v.id("languages"),
    data: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  }).index("by_language", ["languageId"]),

  morphology: defineTable({
    languageId: v.id("languages"),
    data: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  }).index("by_language", ["languageId"]),

  // Individual affixes/patterns get their own table (per Section 9.1's
  // item-level locking + Section 10.1's targeted-write rationale), separate
  // from the morphology stage document above.
  morphologyItems: defineTable({
    languageId: v.id("languages"),
    morphologyId: v.id("morphology"),
    data: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  })
    .index("by_language", ["languageId"])
    .index("by_morphology", ["morphologyId"]),

  // ~500 individually-lockable roots (Section 6.1). Staleness is tracked
  // per item, not as one blanket flag on the collection (Section 10.2a).
  lexiconItems: defineTable({
    languageId: v.id("languages"),
    phonologicalForm: v.string(),
    meaning: v.string(),
    partOfSpeech: v.string(),
    derivationalRelationships: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  }).index("by_language", ["languageId"]),

  syntax: defineTable({
    languageId: v.id("languages"),
    data: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  }).index("by_language", ["languageId"]),

  orthography: defineTable({
    languageId: v.id("languages"),
    data: v.optional(v.any()),
    locked: v.boolean(),
    staleSince: v.union(v.number(), v.null()),
  }).index("by_language", ["languageId"]),

  // Section 10.3: snapshot-anchored diff history. `kind` distinguishes a
  // full snapshot entry from a lightweight diff-from-prior entry.
  stageHistory: defineTable({
    languageId: v.id("languages"),
    stage: stageName,
    kind: v.union(v.literal("snapshot"), v.literal("diff")),
    data: v.any(),
    trigger: v.union(v.literal("nudge"), v.literal("reroll"), v.literal("edit")),
    createdAt: v.number(),
  }).index("by_language_stage", ["languageId", "stage", "createdAt"]),

  // Reserved, structural only in v1 (Section 10.4) — no UI reads/writes
  // these yet beyond what M8 builds.
  languageShares: defineTable({
    languageId: v.id("languages"),
    sharedWith: v.string(), // Clerk user id
    permission: v.union(v.literal("view"), v.literal("edit")),
    createdAt: v.number(),
  })
    .index("by_language", ["languageId"])
    .index("by_shared_with", ["sharedWith"]),

  // Reserved, empty in v1 (Section 10.5) — groundwork for v2 aging/contact.
  languageRelations: defineTable({
    sourceLanguageId: v.id("languages"),
    relatedLanguageId: v.id("languages"),
    relationType: v.string(),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceLanguageId"])
    .index("by_related", ["relatedLanguageId"]),
});
