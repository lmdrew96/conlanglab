import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import { generateLexicon } from "../convex/lexicon/generate";
import { DEFAULT_LEXICON_PARAMS } from "../convex/lexicon/types";
import { generateMorphology } from "../convex/morphology/generate";
import { generateOrthography } from "../convex/orthography/generate";
import { DEFAULT_ORTHOGRAPHY_PARAMS, SCRIPT_CATEGORIES } from "../convex/orthography/types";
import { buildGlossIndex, translate } from "../convex/translate/translate";
import type { TranslateArgs, TranslationResult } from "../convex/translate/translate";
import type { PhonologyData } from "../convex/phonology/types";
import type { LexiconItemData } from "../convex/lexicon/types";
import type { AllomorphyData, MorphologyAffixData, MorphologicalType } from "../convex/morphology/types";
import type { OrthographyStageData } from "../convex/orthography/types";
import type { PhraseStructureData, WordOrder } from "../convex/syntax/types";

const FIXED_NOW = 1_700_000_000_000;

interface Fixture {
  phonology: PhonologyData;
  lexiconItems: LexiconItemData[];
  morphologyItems: MorphologyAffixData[];
  allomorphy: AllomorphyData;
  orthography: OrthographyStageData;
}

/**
 * Builds a whole language the way the app does — and in the app's real
 * order, which matters here: Lexicon's derivation pass (Section 5.5) needs
 * Morphology's derivational affixes, so a lexicon generated before
 * Morphology exists carries no derived items at all. Generating it twice is
 * exactly what a user regenerating Lexicon after Morphology gets.
 */
function buildFixture(seedBase: number, typology: MorphologicalType = "agglutinative", scriptCategory = "alphabetic"): Fixture {
  const phonology = generatePhonology({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_PARAMS,
    previous: null,
    targets: ALL_TARGETS,
    mode: "initial",
    now: FIXED_NOW,
  });
  const bareLexicon = generateLexicon({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_LEXICON_PARAMS,
    phonology,
    previousItems: [],
    mode: "initial",
    now: FIXED_NOW,
  }).items;
  const morphology = generateMorphology({
    seed: { base: seedBase, variation: 0 },
    params: { typology },
    phonology,
    previousItems: [],
    lexiconItems: bareLexicon,
    mode: "initial",
    now: FIXED_NOW,
  });
  const lexiconItems = generateLexicon({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_LEXICON_PARAMS,
    phonology,
    previousItems: [],
    derivationalAffixes: morphology.stage.derivationalAffixes,
    allomorphy: morphology.stage.allomorphy,
    mode: "initial",
    now: FIXED_NOW,
  }).items;
  const orthography = generateOrthography({
    seed: { base: seedBase, variation: 0 },
    params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory: scriptCategory as never },
    phonology,
    lexiconItems,
    previous: null,
    mode: "initial",
    now: FIXED_NOW,
  });
  return { phonology, lexiconItems, morphologyItems: morphology.items, allomorphy: morphology.stage.allomorphy, orthography };
}

function phraseStructureFor(wordOrder: WordOrder): PhraseStructureData {
  return { wordOrder, adpositionOrder: "prepositional", genitiveOrder: "genitiveNoun", adjectiveOrder: "adjectiveNoun" };
}

function run(fixture: Fixture, text: string, overrides: Partial<TranslateArgs> = {}): TranslationResult {
  return translate({
    text,
    lexiconItems: fixture.lexiconItems,
    morphologyItems: fixture.morphologyItems,
    phonology: fixture.phonology,
    allomorphy: fixture.allomorphy,
    mapping: fixture.orthography.mapping,
    aesthetic: fixture.orthography.params.aesthetic,
    phraseStructure: phraseStructureFor("SVO"),
    ...overrides,
  });
}

/** The English source each output word came from, in output order — the compact way to assert on ordering. */
function sources(result: TranslationResult): string[] {
  return result.sentences.flatMap((s) => s.words.map((w) => w.source));
}

/** The lexicon concept ids each output word resolved to, in output order. */
function conceptIds(result: TranslationResult): Array<string | null> {
  return result.sentences.flatMap((s) => s.words.map((w) => w.item?.id ?? null));
}

const fixture = buildFixture(4242);

describe("gloss index", () => {
  it("resolves a plain gloss", () => {
    expect(conceptIds(run(fixture, "sun"))).toEqual(["sun"]);
  });

  it("resolves comma-separated synonyms to the same root", () => {
    // "earth, soil" — both halves index onto the `earth` concept.
    expect(conceptIds(run(fixture, "soil"))).toEqual(["earth"]);
    expect(conceptIds(run(fixture, "earth"))).toEqual(["earth"]);
  });

  it("resolves a gloss with a disambiguating parenthetical", () => {
    // "back (body)" indexes as "back"; "root (of a plant)" as "root" — the
    // parenthetical disambiguates for a human reader, it isn't part of the word.
    expect(conceptIds(run(fixture, "back"))).toEqual(["back_body"]);
    expect(conceptIds(run(fixture, "root"))).toEqual(["root_plant"]);
  });

  it("resolves slash-separated alternatives", () => {
    // "he/she/it" — every alternative reaches the same pronoun.
    expect(conceptIds(run(fixture, "she"))).toEqual(["he_she_it"]);
  });

  it("resolves multiword concept ids typed as spaced words", () => {
    expect(conceptIds(run(fixture, "lie down"))).toEqual(["lie_down"]);
  });

  it("offers suggestions for a word with no root", () => {
    const result = run(fixture, "moonbeam");
    const word = result.sentences[0].words[0];
    expect(word.item).toBeNull();
    expect(word.suggestions.length).toBeGreaterThan(0);
    expect(word.suggestions.some((s) => s.includes("moon"))).toBe(true);
  });

  it("does not suggest tiny roots that merely happen to be substrings", () => {
    // "spaceship" contains "i" (the pronoun) and "ship" (a real root). Only
    // the second is a hint; the first is noise.
    const word = run(fixture, "spaceship").sentences[0].words[0];
    expect(word.suggestions).not.toContain("I");
    expect(word.suggestions.every((s) => s.length >= 3)).toBe(true);
  });

  it("counts resolved vs total words", () => {
    const result = run(fixture, "the sun and zzzzz");
    expect(result.totalCount).toBe(3);
    expect(result.resolvedCount).toBe(2);
  });

  it("is prebuildable and produces identical output when passed in", () => {
    const glossIndex = buildGlossIndex(fixture.lexiconItems);
    expect(run(fixture, "the big mountain", { glossIndex })).toEqual(run(fixture, "the big mountain"));
  });
});

describe("English inflection", () => {
  it("reads a regular plural as a number feature on the noun", () => {
    const word = run(fixture, "stones").sentences[0].words[0];
    expect(word.item?.id).toBe("stone");
    expect(word.appliedAffixes.concat(word.unmarkedFeatures.map(() => null) as never[]).length).toBeGreaterThan(0);
    const marked = [
      ...word.appliedAffixes.flatMap((a) => a.values),
      ...word.unmarkedFeatures,
    ];
    expect(marked.some((v) => v.category === "number" && v.value === "plural")).toBe(true);
  });

  it("reads an irregular plural", () => {
    expect(conceptIds(run(fixture, "children"))).toEqual(["child"]);
  });

  it("reads an irregular past tense", () => {
    const word = run(fixture, "I saw the sun").sentences[0].words.find((w) => w.item?.id === "see");
    expect(word).toBeDefined();
    const marked = [...(word?.appliedAffixes.flatMap((a) => a.values) ?? []), ...(word?.unmarkedFeatures ?? [])];
    expect(marked.some((v) => v.category === "tense" && v.value === "past")).toBe(true);
  });

  it("does not read verbal -s as a plural", () => {
    // "sees" is the verb `see`, not a plural of anything.
    const word = run(fixture, "the child sees the sun").sentences[0].words.find((w) => w.item?.id === "see");
    expect(word).toBeDefined();
    const marked = [...(word?.appliedAffixes.flatMap((a) => a.values) ?? []), ...(word?.unmarkedFeatures ?? [])];
    expect(marked.some((v) => v.category === "number" && v.value === "plural")).toBe(false);
  });

  it("resolves a derived word through its generated gloss", () => {
    // Lexicon stores agentive derivations as "one who runs" (Section 5.5).
    const derived = fixture.lexiconItems.find((i) => i.meaning.startsWith("one who "));
    expect(derived).toBeDefined();
    const stem = derived!.meaning.replace(/^one who /, "").replace(/s$/, "");
    expect(conceptIds(run(fixture, `${stem}er`))).toEqual([derived!.id]);
  });

  it("expands contractions and reads the negation", () => {
    const result = run(fixture, "I don't see the sun");
    const verb = result.sentences[0].words.find((w) => w.item?.id === "see");
    const marked = [...(verb?.appliedAffixes.flatMap((a) => a.values) ?? []), ...(verb?.unmarkedFeatures ?? [])];
    expect(marked.some((v) => v.category === "polarity" && v.value === "negative")).toBe(true);
    // "don't" contributes no word of its own — it folds into the verb.
    expect(sources(result).some((s) => s.includes("not"))).toBe(true);
  });

  it("treats 'have' as a full verb when nothing else can be the verb", () => {
    expect(conceptIds(run(fixture, "I have a stone"))).toContain("have");
  });

  it("treats 'have' as an auxiliary when another verb is present", () => {
    const ids = conceptIds(run(fixture, "I have seen the sun"));
    expect(ids).toContain("see");
    expect(ids).not.toContain("have");
  });
});

describe("absorbed grammar words", () => {
  it("folds an article into the noun it modifies rather than emitting a word", () => {
    const result = run(fixture, "the sun");
    expect(result.sentences[0].words).toHaveLength(1);
    expect(result.sentences[0].words[0].source).toBe("the sun");
  });

  it("folds a possessive determiner into the possessed noun", () => {
    const result = run(fixture, "my mother");
    expect(result.sentences[0].words).toHaveLength(1);
    expect(result.sentences[0].words[0].item?.id).toBe("mother");
    expect(result.sentences[0].words[0].source).toBe("my mother");
  });

  it("does not lose trailing grammar with nothing after it", () => {
    const result = run(fixture, "we did not");
    expect(sources(result).join(" ")).toContain("not");
  });
});

describe("constituent order", () => {
  const orders: WordOrder[] = ["SOV", "SVO", "VSO", "VOS", "OVS", "OSV"];

  it.each(orders)("reorders a simple clause to %s", (wordOrder) => {
    const result = run(fixture, "the child sees the sun", { phraseStructure: phraseStructureFor(wordOrder) });
    expect(result.sentences[0].reordered).toBe(true);

    const roles = result.sentences[0].words.map((w) => w.role);
    const expected = wordOrder.split("").map((slot) => ({ S: "subject", V: "verb", O: "object" })[slot as "S" | "V" | "O"]);
    expect(roles).toEqual(expected);
  });

  it("puts adjectives on the side the language puts them", () => {
    const before = run(fixture, "big mountain", {
      phraseStructure: { ...phraseStructureFor("SVO"), adjectiveOrder: "adjectiveNoun" },
    });
    const after = run(fixture, "big mountain", {
      phraseStructure: { ...phraseStructureFor("SVO"), adjectiveOrder: "nounAdjective" },
    });
    expect(conceptIds(before)).toEqual(["big", "mountain"]);
    expect(conceptIds(after)).toEqual(["mountain", "big"]);
  });

  it("orders an apostrophe-s possessive per genitiveOrder", () => {
    const genitiveNoun = run(fixture, "the child's mother", {
      phraseStructure: { ...phraseStructureFor("SVO"), genitiveOrder: "genitiveNoun" },
    });
    const nounGenitive = run(fixture, "the child's mother", {
      phraseStructure: { ...phraseStructureFor("SVO"), genitiveOrder: "nounGenitive" },
    });
    expect(conceptIds(genitiveNoun)).toEqual(["child", "mother"]);
    expect(conceptIds(nounGenitive)).toEqual(["mother", "child"]);
  });

  it("reads an 'of' possessive as the same structure, from the other direction", () => {
    const result = run(fixture, "the mother of the child", {
      phraseStructure: { ...phraseStructureFor("SVO"), genitiveOrder: "genitiveNoun" },
    });
    expect(conceptIds(result)).toEqual(["child", "mother"]);
    expect(result.sentences[0].words.map((w) => w.role)).toEqual(["possessor", "other"]);
  });

  it("orders an adpositional phrase per adpositionOrder", () => {
    const prepositional = run(fixture, "in the forest", {
      phraseStructure: { ...phraseStructureFor("SVO"), adpositionOrder: "prepositional" },
    });
    const postpositional = run(fixture, "in the forest", {
      phraseStructure: { ...phraseStructureFor("SVO"), adpositionOrder: "postpositional" },
    });
    expect(conceptIds(prepositional)).toEqual(["in", "forest"]);
    expect(conceptIds(postpositional)).toEqual(["forest", "in"]);
  });

  it("keeps an adjective attached to its noun when the clause reorders", () => {
    const result = run(fixture, "the big child sees the small sun", { phraseStructure: phraseStructureFor("SOV") });
    expect(conceptIds(result)).toEqual(["big", "child", "small", "sun", "see"]);
  });

  it("falls back to source order when a coordinator makes the clause ambiguous", () => {
    const result = run(fixture, "I see the sun and the moon rises", { phraseStructure: phraseStructureFor("SOV") });
    expect(result.sentences[0].reordered).toBe(false);
  });

  it("falls back to source order rather than relocating a word with no S/V/O slot", () => {
    // "where" is a real adverb root but has no constituent slot to travel in;
    // reordering around it would move it somewhere the English never put it.
    const result = run(fixture, "where is the sun", { phraseStructure: phraseStructureFor("SOV") });
    expect(result.sentences[0].reordered).toBe(false);
    expect(conceptIds(result)).toEqual(["where", "be", "sun"]);
  });

  it("does not case-mark an adpositional phrase as the verb's object", () => {
    // "to the forest" takes its case from the adposition governing it, not
    // from the verb.
    const result = run(fixture, "the bird flies to the forest");
    const forest = result.sentences[0].words.find((w) => w.item?.id === "forest");
    const marked = [...(forest?.appliedAffixes.flatMap((a) => a.values) ?? []), ...(forest?.unmarkedFeatures ?? [])];
    expect(marked.some((v) => v.category === "case" && v.value === "accusative")).toBe(false);
  });

  it("never drops or duplicates a word when reordering", () => {
    for (const wordOrder of orders) {
      const result = run(fixture, "the big child sees the small sun", { phraseStructure: phraseStructureFor(wordOrder) });
      expect(conceptIds(result).slice().sort()).toEqual(["big", "child", "see", "small", "sun"]);
    }
  });

  it("falls back to source order when there is more than one nominal on a side", () => {
    const result = run(fixture, "the child water sees the sun", { phraseStructure: phraseStructureFor("SOV") });
    expect(result.sentences[0].reordered).toBe(false);
  });

  it("keeps source order entirely when Syntax has not been generated", () => {
    const result = run(fixture, "the child sees the sun", { phraseStructure: null });
    expect(result.sentences[0].reordered).toBe(false);
    expect(conceptIds(result)).toEqual(["child", "see", "sun"]);
  });

  it("splits multiple sentences and reorders each independently", () => {
    const result = run(fixture, "the child sees the sun. the bird sleeps", {
      phraseStructure: phraseStructureFor("SOV"),
    });
    expect(result.sentences).toHaveLength(2);
    expect(result.sentences[0].terminator).toBe(".");
    expect(conceptIds(result)).toEqual(["child", "sun", "see", "bird", "sleep"]);
  });

  it("reorders a clause whose object is an unknown word", () => {
    // An unresolved noun still has to travel to the object slot, or a
    // 500-root lexicon makes reordering useless in practice.
    const result = run(fixture, "the child sees the zzzzz", { phraseStructure: phraseStructureFor("SOV") });
    expect(result.sentences[0].reordered).toBe(true);
    expect(result.sentences[0].words.map((w) => w.role)).toEqual(["subject", "object", "verb"]);
  });
});

describe("grammatical marking", () => {
  it("marks the object with accusative case when the language has one", () => {
    const withCase = buildFixture(99, "fusional");
    const hasAccusative = withCase.morphologyItems.some((a) =>
      a.values.some((v) => v.category === "case" && v.value === "accusative"),
    );
    const result = translate({
      text: "the child sees the sun",
      lexiconItems: withCase.lexiconItems,
      morphologyItems: withCase.morphologyItems,
      phonology: withCase.phonology,
      allomorphy: withCase.allomorphy,
      mapping: withCase.orthography.mapping,
      aesthetic: withCase.orthography.params.aesthetic,
      phraseStructure: phraseStructureFor("SVO"),
    });
    const object = result.sentences[0].words.find((w) => w.role === "object");
    const marked = [...(object?.appliedAffixes.flatMap((a) => a.values) ?? []), ...(object?.unmarkedFeatures ?? [])];
    expect(marked.some((v) => v.category === "case" && v.value === "accusative")).toBe(hasAccusative || marked.length > 0);
  });

  it("reports a feature the language does not mark instead of silently dropping it", () => {
    const isolating = buildFixture(7, "isolating");
    const result = translate({
      text: "stones",
      lexiconItems: isolating.lexiconItems,
      morphologyItems: isolating.morphologyItems,
      phonology: isolating.phonology,
      allomorphy: isolating.allomorphy,
      mapping: isolating.orthography.mapping,
      aesthetic: isolating.orthography.params.aesthetic,
      phraseStructure: phraseStructureFor("SVO"),
    });
    const word = result.sentences[0].words[0];
    const hasPluralAffix = isolating.morphologyItems.some((a) =>
      a.values.some((v) => v.category === "number" && v.value === "plural"),
    );
    if (!hasPluralAffix) {
      expect(word.unmarkedFeatures.some((f) => f.category === "number" && f.value === "plural")).toBe(true);
      expect(word.appliedAffixes).toHaveLength(0);
    }
  });

  it("never silently pluralizes a singular noun via a fusional bundle", () => {
    // A fusional case+number affix comes in one cell per combination. Picking
    // whichever one happens to be first would inflect "the stone" as plural
    // roughly half the time; the singular cell is zero-marked and has to win.
    for (const seed of [11, 22, 33, 44, 55]) {
      const fusional = buildFixture(seed, "fusional");
      const result = translate({
        text: "the child sees the stone",
        lexiconItems: fusional.lexiconItems,
        morphologyItems: fusional.morphologyItems,
        phonology: fusional.phonology,
        allomorphy: fusional.allomorphy,
        mapping: fusional.orthography.mapping,
        aesthetic: fusional.orthography.params.aesthetic,
        phraseStructure: phraseStructureFor("SVO"),
      });
      for (const word of result.sentences.flatMap((s) => s.words)) {
        const applied = word.appliedAffixes.flatMap((a) => a.values);
        expect(applied.some((v) => v.category === "number" && v.value === "plural")).toBe(false);
      }
    }
  });

  it("reports a fused value the English never asked for rather than hiding it", () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const fusional = buildFixture(seed, "fusional");
      const result = translate({
        text: "the child sees the stone",
        lexiconItems: fusional.lexiconItems,
        morphologyItems: fusional.morphologyItems,
        phonology: fusional.phonology,
        allomorphy: fusional.allomorphy,
        mapping: fusional.orthography.mapping,
        aesthetic: fusional.orthography.params.aesthetic,
        phraseStructure: phraseStructureFor("SVO"),
      });
      for (const word of result.sentences.flatMap((s) => s.words)) {
        const requested = new Set(["case", "number", "definiteness", "tense", "agreement", "polarity", "possession"]);
        for (const value of word.appliedAffixes.flatMap((a) => a.values)) {
          // Anything an applied affix marks is either something the sentence
          // implied, an unmarked baseline, or explicitly listed as incidental.
          const isIncidental = word.incidentalValues.some(
            (v) => v.category === value.category && v.value === value.value,
          );
          expect(requested.has(value.category) || isIncidental).toBe(true);
        }
      }
    }
  });

  it("never applies two affixes covering the same category", () => {
    const result = run(fixture, "the children saw the stones");
    for (const word of result.sentences.flatMap((s) => s.words)) {
      const categories = word.appliedAffixes.flatMap((a) => a.values.map((v) => v.category));
      expect(new Set(categories).size).toBe(categories.length);
    }
  });

  it("leaves a zero-marked value unmarked and does not report it", () => {
    // "a sun" is indefinite — the typologically unmarked baseline, so a bare
    // root is the correct output and there is nothing to tell the user.
    const word = run(fixture, "a sun").sentences[0].words[0];
    expect(word.unmarkedFeatures.some((f) => f.category === "definiteness")).toBe(false);
  });

  it("assembles a real IPA form for every resolved word", () => {
    const result = run(fixture, "the child sees the big sun");
    for (const word of result.sentences.flatMap((s) => s.words)) {
      if (word.item) expect(word.form.length).toBeGreaterThan(0);
      else expect(word.form).toBe("");
    }
  });
});

describe("glyph composition", () => {
  it.each(SCRIPT_CATEGORIES)("produces glyph steps for a %s script", (scriptCategory) => {
    const scripted = buildFixture(31337, "agglutinative", scriptCategory);
    const result = translate({
      text: "the child sees the sun",
      lexiconItems: scripted.lexiconItems,
      morphologyItems: scripted.morphologyItems,
      phonology: scripted.phonology,
      allomorphy: scripted.allomorphy,
      mapping: scripted.orthography.mapping,
      aesthetic: scripted.orthography.params.aesthetic,
      phraseStructure: phraseStructureFor("SVO"),
    });
    const resolvedWords = result.sentences.flatMap((s) => s.words).filter((w) => w.item);
    expect(resolvedWords.length).toBeGreaterThan(0);
    for (const word of resolvedWords) {
      expect(word.glyphSteps.length).toBeGreaterThan(0);
    }
  });

  it("writes a logographic word as exactly one concept sign", () => {
    const logographic = buildFixture(31337, "agglutinative", "logographic");
    const result = translate({
      text: "the children",
      lexiconItems: logographic.lexiconItems,
      morphologyItems: logographic.morphologyItems,
      phonology: logographic.phonology,
      allomorphy: logographic.allomorphy,
      mapping: logographic.orthography.mapping,
      aesthetic: logographic.orthography.params.aesthetic,
      phraseStructure: phraseStructureFor("SVO"),
    });
    const word = result.sentences[0].words[0];
    expect(word.item?.id).toBe("child");
    expect(word.glyphSteps).toHaveLength(1);
    expect(word.glyphSteps[0].junctionBefore).toBeNull();
  });

  it("every emitted glyph id exists in the script (or is a composable syllable)", () => {
    for (const scriptCategory of SCRIPT_CATEGORIES) {
      const scripted = buildFixture(555, "agglutinative", scriptCategory);
      const known = new Set(scripted.orthography.glyphs.map((g) => g.id));
      const result = translate({
        text: "the big child sees the stones",
        lexiconItems: scripted.lexiconItems,
        morphologyItems: scripted.morphologyItems,
        phonology: scripted.phonology,
        allomorphy: scripted.allomorphy,
        mapping: scripted.orthography.mapping,
        aesthetic: scripted.orthography.params.aesthetic,
        phraseStructure: phraseStructureFor("SVO"),
      });
      for (const word of result.sentences.flatMap((s) => s.words)) {
        for (const step of word.glyphSteps) {
          const composable = scripted.orthography.mapping.kind === "syllabic" && step.glyphId.includes("+");
          expect(known.has(step.glyphId) || composable).toBe(true);
        }
      }
    }
  });
});

describe("robustness", () => {
  it("returns nothing for empty or punctuation-only input", () => {
    expect(run(fixture, "").sentences).toHaveLength(0);
    expect(run(fixture, "   ").sentences).toHaveLength(0);
    expect(run(fixture, "...").sentences).toHaveLength(0);
    expect(run(fixture, "?!").sentences).toHaveLength(0);
  });

  it("handles input made entirely of unknown words", () => {
    const result = run(fixture, "zzzzz qqqqq");
    expect(result.resolvedCount).toBe(0);
    expect(result.totalCount).toBe(2);
  });

  it("is deterministic across repeated calls", () => {
    expect(run(fixture, "the child sees the big sun")).toEqual(run(fixture, "the child sees the big sun"));
  });

  it("survives every typology without throwing", () => {
    for (const typology of ["isolating", "agglutinative", "fusional", "polysynthetic"] as MorphologicalType[]) {
      const typed = buildFixture(808, typology);
      expect(() =>
        translate({
          text: "the children did not see my mother's big stones in the forest",
          lexiconItems: typed.lexiconItems,
          morphologyItems: typed.morphologyItems,
          phonology: typed.phonology,
          allomorphy: typed.allomorphy,
          mapping: typed.orthography.mapping,
          aesthetic: typed.orthography.params.aesthetic,
          phraseStructure: phraseStructureFor("VSO"),
        }),
      ).not.toThrow();
    }
  });
});
