import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import { generateLexicon } from "../convex/lexicon/generate";
import { DEFAULT_LEXICON_PARAMS } from "../convex/lexicon/types";
import { generateOrthography } from "../convex/orthography/generate";
import { glyphToSvgPath } from "../convex/orthography/render";
import { ANCESTOR_SCRIPT_FAMILIES, AESTHETICS, DEFAULT_ORTHOGRAPHY_PARAMS, SCRIPT_CATEGORIES } from "../convex/orthography/types";
import type { PhonologyData, ConsonantPhoneme } from "../convex/phonology/types";
import type { AncestorScriptFamily } from "../convex/orthography/types";
import type { LexiconItemData } from "../convex/lexicon/types";
import type { Glyph, Point, Stroke } from "../convex/orthography/types";

const FIXED_NOW = 1_700_000_000_000;
// Same tolerance the patch's acceptance criteria calls for — real coordinate
// sharing, not "close enough to look related."
const EPSILON = 2;

function testPhonology(seedBase: number): PhonologyData {
  return generatePhonology({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_PARAMS,
    previous: null,
    targets: ALL_TARGETS,
    mode: "initial",
    now: FIXED_NOW,
  });
}

function testLexicon(seedBase: number, phonology: PhonologyData): LexiconItemData[] {
  return generateLexicon({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_LEXICON_PARAMS,
    phonology,
    previousItems: [],
    mode: "initial",
    now: FIXED_NOW,
  }).items;
}

/** A stroke's own connectable coordinates — for line/curve/dot these are literal fields; a hook's far end isn't stored as a field but is exactly reproducible (same formula as render.ts's strokeToSvgPath), and the generator relies on that computed point to chain the next stroke onto it. */
function strokePoints(stroke: Stroke): Point[] {
  switch (stroke.kind) {
    case "line":
      return [stroke.from, stroke.to];
    case "curve":
      return [stroke.from, stroke.control, stroke.to];
    case "dot":
      return [stroke.center];
    case "hook": {
      const rad = (stroke.angle * Math.PI) / 180;
      const end = { x: stroke.anchor.x + Math.cos(rad) * stroke.length, y: stroke.anchor.y + Math.sin(rad) * stroke.length };
      return [stroke.anchor, end];
    }
  }
}

/** The one coordinate that "connects" a stroke to whatever came before it. */
function connectingPoint(stroke: Stroke): Point {
  switch (stroke.kind) {
    case "line":
    case "curve":
      return stroke.from;
    case "dot":
      return stroke.center;
    case "hook":
      return stroke.anchor;
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True if at least one non-primary stroke's connecting coordinate lands within EPSILON of some point on another stroke in the same glyph — the patch's literal acceptance criterion. */
function hasConnectedPair(glyph: Glyph): boolean {
  const { strokes } = glyph;
  for (let i = 1; i < strokes.length; i++) {
    const point = connectingPoint(strokes[i]);
    for (let j = 0; j < strokes.length; j++) {
      if (j === i) continue;
      if (strokePoints(strokes[j]).some((p) => distance(p, point) <= EPSILON)) return true;
    }
  }
  return false;
}

/** Every coordinate field a Stroke actually stores — a hook's far end isn't one of them (only its anchor is), matching the bug report's own "from/to/center/anchor/control" list. */
function strokeCoordinates(stroke: Stroke): Point[] {
  switch (stroke.kind) {
    case "line":
      return [stroke.from, stroke.to];
    case "curve":
      return [stroke.from, stroke.control, stroke.to];
    case "dot":
      return [stroke.center];
    case "hook":
      return [stroke.anchor];
  }
}

function edgePlaceConsonant(place: "bilabial" | "glottal"): ConsonantPhoneme {
  return {
    id: `edge:${place}`,
    ipa: place,
    features: { place, manner: "stop", voiced: false },
    tier: "core",
    prerequisites: [],
    locked: false,
  };
}

const SEEDS = [111, 222, 333];

describe("generateOrthography glyph connectivity", () => {
  const phonology = testPhonology(1);
  const lexiconItems = testLexicon(1, phonology);

  for (const scriptCategory of SCRIPT_CATEGORIES) {
    for (const aesthetic of AESTHETICS) {
      for (const seedBase of SEEDS) {
        it(`connects multi-stroke glyphs (${scriptCategory}/${aesthetic}/${seedBase})`, () => {
          const data = generateOrthography({
            seed: { base: seedBase, variation: 0 },
            params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory, aesthetic },
            phonology,
            lexiconItems,
            previous: null,
            mode: "initial",
            now: FIXED_NOW,
          });

          const multiStrokeGlyphs = data.glyphs.filter((g) => g.strokes.length > 1);
          expect(multiStrokeGlyphs.length).toBeGreaterThan(0);
          for (const glyph of multiStrokeGlyphs) {
            expect(hasConnectedPair(glyph), `glyph "${glyph.id}" (${glyph.kind}) has no connected stroke pair`).toBe(true);
          }
        });
      }
    }
  }
});

// Regression coverage for the two failure modes found in the just-shipped
// connectivity fix: Bug A (a "dot" picked as the chain's own skeleton stroke
// never moves the cursor, so a glyph's whole rendered path collapses to
// overlapping same-point circles with zero lines/curves/hooks) and Bug B
// (an edge-place glyph's local grid landing partially/fully outside the
// viewBox — generates without error, renders invisible).

describe("generateOrthography glyph skeletons never degenerate to dot-only", () => {
  const phonology = testPhonology(1);
  const lexiconItems = testLexicon(1, phonology);
  // The exact seeds from the screenshots that first surfaced the bug, plus
  // the broader connectivity-test sweep for good measure.
  const REGRESSION_SEEDS: Array<{ scriptCategory: (typeof SCRIPT_CATEGORIES)[number]; aesthetic: (typeof AESTHETICS)[number]; seedBase: number }> = [
    { scriptCategory: "abjad", aesthetic: "invented", seedBase: 555 },
    { scriptCategory: "abugida", aesthetic: "realLike", seedBase: 666 },
    { scriptCategory: "alphabetic", aesthetic: "realLike", seedBase: 333 },
    { scriptCategory: "alphabetic", aesthetic: "realLike", seedBase: 444 },
    { scriptCategory: "alphabetic", aesthetic: "invented", seedBase: 111 },
    { scriptCategory: "alphabetic", aesthetic: "invented", seedBase: 222 },
  ];

  for (const { scriptCategory, aesthetic, seedBase } of REGRESSION_SEEDS) {
    it(`no blank/dot-only cells (${scriptCategory}/${aesthetic}/${seedBase})`, () => {
      const data = generateOrthography({
        seed: { base: seedBase, variation: 0 },
        params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory, aesthetic },
        phonology,
        lexiconItems,
        previous: null,
        mode: "initial",
        now: FIXED_NOW,
      });

      expect(data.glyphs.length).toBeGreaterThan(0);
      for (const glyph of data.glyphs) {
        expect(glyph.strokes.length, `glyph "${glyph.id}" (${glyph.kind}) has zero strokes`).toBeGreaterThan(0);
        const hasSkeletonStroke = glyph.strokes.some((s) => s.kind !== "dot");
        expect(hasSkeletonStroke, `glyph "${glyph.id}" (${glyph.kind}) is dot-only — no line/curve/hook skeleton`).toBe(true);
      }
    });
  }

  // General sweep across every category/aesthetic/seed combo the connectivity
  // suite above already exercises, same "dot-only skeleton" assertion.
  for (const scriptCategory of SCRIPT_CATEGORIES) {
    for (const aesthetic of AESTHETICS) {
      for (const seedBase of SEEDS) {
        it(`no dot-only glyphs (${scriptCategory}/${aesthetic}/${seedBase})`, () => {
          const data = generateOrthography({
            seed: { base: seedBase, variation: 0 },
            params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory, aesthetic },
            phonology,
            lexiconItems,
            previous: null,
            mode: "initial",
            now: FIXED_NOW,
          });
          for (const glyph of data.glyphs) {
            expect(glyph.strokes.some((s) => s.kind !== "dot"), `glyph "${glyph.id}" (${glyph.kind}) is dot-only`).toBe(true);
          }
        });
      }
    }
  }
});

describe("generateOrthography keeps every stroke coordinate on-canvas", () => {
  const lexiconItems: LexiconItemData[] = [];
  const ANCESTOR_OPTIONS: Array<AncestorScriptFamily | null> = [null, ...ANCESTOR_SCRIPT_FAMILIES];
  const EDGE_SEEDS = [11, 22, 33, 44, 55];

  for (const ancestorScript of ANCESTOR_OPTIONS) {
    for (const seedBase of EDGE_SEEDS) {
      it(`bilabial + glottal glyphs stay within the viewBox (ancestorScript=${ancestorScript ?? "null"}, seed=${seedBase})`, () => {
        const phonology: PhonologyData = { ...testPhonology(seedBase), consonants: [edgePlaceConsonant("bilabial"), edgePlaceConsonant("glottal")] };
        const data = generateOrthography({
          seed: { base: seedBase, variation: 0 },
          params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory: "alphabetic", ancestorScript },
          phonology,
          lexiconItems,
          previous: null,
          mode: "initial",
          now: FIXED_NOW,
        });

        const viewBoxSize = data.scriptStyle.viewBoxSize;
        const edgeGlyphs = data.glyphs.filter((g) => g.id.startsWith("edge:"));
        expect(edgeGlyphs.length).toBe(2);
        for (const glyph of edgeGlyphs) {
          for (const stroke of glyph.strokes) {
            for (const point of strokeCoordinates(stroke)) {
              expect(point.x, `glyph "${glyph.id}" stroke x escaped viewBox: ${point.x}`).toBeGreaterThanOrEqual(0);
              expect(point.x, `glyph "${glyph.id}" stroke x escaped viewBox: ${point.x}`).toBeLessThanOrEqual(viewBoxSize);
              expect(point.y, `glyph "${glyph.id}" stroke y escaped viewBox: ${point.y}`).toBeGreaterThanOrEqual(0);
              expect(point.y, `glyph "${glyph.id}" stroke y escaped viewBox: ${point.y}`).toBeLessThanOrEqual(viewBoxSize);
            }
          }
        }
      });
    }
  }
});

// Reference-font restraint pass: 15 professionally-made constructed-script
// fonts (Aurebesh, Sith, Tau, Reanaarian, etc. — see the ChaosPatch notes)
// measured at ~1.0-2.2 contours/glyph via fontTools, median ~1.4. The old
// generator stacked every applicable decorative mark (manner radical +
// voiced dot + secondary hook + overflow mark, all unconditional/
// independent) on top of the connected chain, guaranteeing far more
// fragmentation than nearly every reference font. Originally "fixed" by
// capping decorative marks at 1/glyph (priority: secondary > voiced >
// overflow) and shrinking buildScriptStyle's strokeCountRange toward
// near-constant 1 — but that shrink was compensating for glyphToSvgPath
// giving every Stroke object its own SVG "M", which conflated "number of
// Stroke objects" with "number of rendered contours." Now that connected
// chain segments merge into one subpath (render.ts's glyphToSvgPath), this
// counts actual rendered "M" subpaths instead of glyph.strokes.length, so
// strokeCountRange can stay at its full envelope without re-inflating the
// measured average.

function countRenderedSubpaths(path: string): number {
  return (path.match(/M/g) ?? []).length;
}

describe("generateOrthography matches reference-font contour restraint", () => {
  // Deterministic (seeded Rng, no wall-clock/Math.random) — same 100 seeds
  // always produce the same average, so this is a real regression gate, not
  // a flaky sample.
  const MEASURE_SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

  for (const aesthetic of AESTHETICS) {
    it(`avg contours/glyph lands in the reference range (${aesthetic})`, () => {
      const samples: number[] = [];
      for (const seedBase of MEASURE_SEEDS) {
        const phonology = testPhonology(seedBase);
        const data = generateOrthography({
          seed: { base: seedBase, variation: 0 },
          params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory: "alphabetic", aesthetic },
          phonology,
          lexiconItems: [],
          previous: null,
          mode: "initial",
          now: FIXED_NOW,
        });
        for (const glyph of data.glyphs) samples.push(countRenderedSubpaths(glyphToSvgPath(glyph)));
      }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      // Measured the same way as the references: rendered SVG subpath count
      // per glyph, averaged. Reference median ~1.4; target band is the
      // patch's own acceptance criterion (1.3-1.6), not just
      // "connected"/"on-canvas."
      expect(avg, `avg contours/glyph (${aesthetic}) = ${avg.toFixed(3)}, n=${samples.length}`).toBeGreaterThanOrEqual(1.3);
      expect(avg, `avg contours/glyph (${aesthetic}) = ${avg.toFixed(3)}, n=${samples.length}`).toBeLessThanOrEqual(1.6);
    });
  }
});

describe("generateOrthography caps decorative marks at one per glyph", () => {
  const MANNERS: ConsonantPhoneme["features"]["manner"][] = [
    "stop",
    "nasal",
    "fricative",
    "affricate",
    "approximant",
    "lateralApproximant",
    "trill",
    "tap",
    "lateralFricative",
    "click",
    "ejective",
    "implosive",
  ];
  const SECONDARIES: Array<ConsonantPhoneme["features"]["secondary"]> = [
    undefined,
    "labialized",
    "palatalized",
    "velarized",
    "aspirated",
    "glottalized",
  ];

  function matrixConsonant(manner: ConsonantPhoneme["features"]["manner"], voiced: boolean, secondary: ConsonantPhoneme["features"]["secondary"]): ConsonantPhoneme {
    return {
      id: `${manner}:${voiced}:${secondary ?? "none"}`,
      ipa: "x",
      features: { place: "alveolar", manner, voiced, secondary },
      tier: "core",
      prerequisites: [],
      locked: false,
    };
  }

  it("no consonant glyph exceeds chain-length + 1 mark, across every manner x voicing x secondary combination", () => {
    const consonants: ConsonantPhoneme[] = [];
    for (const manner of MANNERS) {
      for (const voiced of [true, false]) {
        for (const secondary of SECONDARIES) consonants.push(matrixConsonant(manner, voiced, secondary));
      }
    }
    const basePhonology = testPhonology(1);
    const phonology: PhonologyData = { ...basePhonology, consonants };

    for (const aesthetic of AESTHETICS) {
      const data = generateOrthography({
        seed: { base: 1, variation: 0 },
        params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory: "abjad", aesthetic, overflowStrategy: "extendedInventory" },
        phonology,
        lexiconItems: [],
        previous: null,
        mode: "initial",
        now: FIXED_NOW,
      });
      const maxAllowed = data.scriptStyle.strokeCountRange[1] + 1;
      expect(data.glyphs.length).toBe(consonants.length);
      for (const glyph of data.glyphs) {
        expect(
          glyph.strokes.length,
          `glyph "${glyph.id}" (${aesthetic}) has ${glyph.strokes.length} strokes, exceeding chain max (${data.scriptStyle.strokeCountRange[1]}) + 1 mark`,
        ).toBeLessThanOrEqual(maxAllowed);
      }
    }
  });
});

// Regression coverage for the "scribble" bug: pickGridPoint had no concept
// of the chain's current direction of travel, so a multi-segment chain
// could legally reverse hard back over a segment that just drew it. Masked
// while strokeCountRange was pinned near-1 by the mark-restraint patch (a
// 1-segment chain can't reverse against itself); visible again now that
// chains are back to their full 2-4/2-5 envelope.

/** A stroke's own direction vector (its end minus its start) — null for "dot", which has no direction of its own. Same computed-hook-end formula as strokePoints/render.ts. */
function strokeDirection(stroke: Stroke): Point | null {
  switch (stroke.kind) {
    case "line":
    case "curve":
      return { x: stroke.to.x - stroke.from.x, y: stroke.to.y - stroke.from.y };
    case "dot":
      return null;
    case "hook": {
      const rad = (stroke.angle * Math.PI) / 180;
      return { x: Math.cos(rad) * stroke.length, y: Math.sin(rad) * stroke.length };
    }
  }
}

/** Same formula as generate.ts's turnAngleDegrees — 0 = continuing straight ahead, 180 = a complete reversal. Duplicated locally rather than importing an internal, matching this file's existing convention (strokePoints/connectingPoint) of reimplementing small geometry helpers for black-box testing through the public API. */
function turnAngleDegrees(incoming: Point, outgoing: Point): number {
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

const MAX_TURN_ANGLE_DEGREES = 150;
// Float round-trip through atan2/cos/sin (hook's reconstructed direction)
// can land a hair over the exact threshold without representing a real
// additional reversal — same spirit as this file's own EPSILON tolerance.
const ANGLE_EPSILON = 0.5;

describe("generateOrthography chain segments never reverse direction", () => {
  const ALL_MANNERS: ConsonantPhoneme["features"]["manner"][] = [
    "stop",
    "nasal",
    "fricative",
    "affricate",
    "approximant",
    "lateralApproximant",
    "trill",
    "tap",
    "lateralFricative",
    "click",
    "ejective",
    "implosive",
  ];
  const PLACES: ConsonantPhoneme["features"]["place"][] = ["bilabial", "alveolar", "velar", "glottal"];

  function noMarkConsonant(manner: ConsonantPhoneme["features"]["manner"], place: ConsonantPhoneme["features"]["place"]): ConsonantPhoneme {
    // Unvoiced, no secondary articulation — guarantees buildConsonantStrokes
    // never appends a decorative mark, so every stroke in the resulting
    // glyph is pure connected-chain output (the only thing this check cares
    // about; an appended mark is a deliberately disconnected jump, not a
    // "reversal" bug).
    return { id: `${place}-${manner}`, ipa: "x", features: { place, manner, voiced: false }, tier: "core", prerequisites: [], locked: false };
  }

  const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

  for (const aesthetic of AESTHETICS) {
    it(`no chain segment reverses past ${MAX_TURN_ANGLE_DEGREES}° (${aesthetic})`, () => {
      const consonants = ALL_MANNERS.flatMap((manner) => PLACES.map((place) => noMarkConsonant(manner, place)));
      let checkedPairs = 0;

      for (const seedBase of SEEDS) {
        const basePhonology = testPhonology(seedBase);
        // overflowStrategy stays the default "extendedInventory" (never
        // marks overflow) and vowels are forced unrounded, so — like the
        // consonants above — no glyph in this sweep ever gets an appended
        // mark; every stroke is chain output.
        const phonology: PhonologyData = {
          ...basePhonology,
          consonants,
          vowels: basePhonology.vowels.map((v) => ({ ...v, features: { ...v.features, rounded: false } })),
        };
        const data = generateOrthography({
          seed: { base: seedBase, variation: 0 },
          params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory: "alphabetic", aesthetic },
          phonology,
          lexiconItems: [],
          previous: null,
          mode: "initial",
          now: FIXED_NOW,
        });

        for (const glyph of data.glyphs) {
          let incoming: Point | null = null;
          for (const stroke of glyph.strokes) {
            const outgoing = strokeDirection(stroke);
            if (incoming && outgoing) {
              const turn = turnAngleDegrees(incoming, outgoing);
              checkedPairs++;
              expect(turn, `glyph "${glyph.id}" (${aesthetic}, seed ${seedBase}) reversed ${turn.toFixed(1)}°`).toBeLessThanOrEqual(
                MAX_TURN_ANGLE_DEGREES + ANGLE_EPSILON,
              );
            }
            if (outgoing) incoming = outgoing;
          }
        }
      }
      // Sanity check on the test itself — if this is 0, the fixture stopped
      // producing multi-segment chains and the assertions above are vacuous.
      expect(checkedPairs).toBeGreaterThan(0);
    });
  }
});
