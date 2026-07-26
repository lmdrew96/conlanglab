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

// Reference-font restraint pass. 30 professionally-made constructed-script
// fonts in fonts/scripts/ measure 1.1-2.2 contours/glyph via fontTools —
// but that number is measured on FILLED OUTLINES, where a "T" is a single
// closed contour. This generator emits stroked centerlines, where a T is
// unavoidably two subpaths: the pen cannot traverse a junction without
// lifting. The two measurements are not commensurable, and earlier patches
// chasing 1.4 here ended up pinning stroke counts near 1 to compensate for
// what turned out to be a render.ts fragmentation bug.
//
// So this is a REGRESSION GATE on stroke-based construction, not a
// reference-matching target. The floor keeps glyphs from collapsing to a
// bare armature; the ceiling catches the mark-stacking and subpath-
// fragmentation regressions that have bitten this engine repeatedly.

function countRenderedSubpaths(path: string): number {
  return (path.match(/M/g) ?? []).length;
}

describe("generateOrthography keeps contour count restrained", () => {
  // Deterministic (seeded Rng, no wall-clock/Math.random) — same 100 seeds
  // always produce the same average, so this is a real regression gate, not
  // a flaky sample.
  const MEASURE_SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

  for (const aesthetic of AESTHETICS) {
    it(`avg contours/glyph stays in the stroked-construction band (${aesthetic})`, () => {
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
      expect(avg, `avg contours/glyph (${aesthetic}) = ${avg.toFixed(3)}, n=${samples.length}`).toBeGreaterThanOrEqual(1.5);
      expect(avg, `avg contours/glyph (${aesthetic}) = ${avg.toFixed(3)}, n=${samples.length}`).toBeLessThanOrEqual(2.9);
    });
  }
});

// The v2 acceptance criteria: rail discipline and footprint consistency.
// These are the two things the reference fonts DO measure commensurably,
// and the two the pre-armature generator failed hardest — measured ink
// top/bottom edge stddev of 0.10-0.19 em against 0.001-0.016 for
// Britannian/Aurebesh/Tau/Xidus, i.e. every glyph floating at its own
// height instead of sitting on shared rails. That is what made a row of
// generated glyphs read as static rather than as text.

/** Every point a stroke's rendered ink actually reaches — a dot's extremes are its bounding box, not its center. */
function inkPoints(stroke: Stroke): Point[] {
  switch (stroke.kind) {
    case "line":
      return [stroke.from, stroke.to];
    // A quadratic stays inside the convex hull of its three control points,
    // so the hull is a sound (if slightly loose) bound on the drawn curve.
    case "curve":
      return [stroke.from, stroke.control, stroke.to];
    case "dot":
      return [
        { x: stroke.center.x - stroke.radius, y: stroke.center.y - stroke.radius },
        { x: stroke.center.x + stroke.radius, y: stroke.center.y + stroke.radius },
      ];
    case "hook": {
      const rad = (stroke.angle * Math.PI) / 180;
      return [stroke.anchor, { x: stroke.anchor.x + Math.cos(rad) * stroke.length, y: stroke.anchor.y + Math.sin(rad) * stroke.length }];
    }
  }
}

function inkBounds(glyph: Glyph) {
  const points = glyph.strokes.flatMap(inkPoints);
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

describe("generateOrthography holds every glyph to shared rails", () => {
  const RAIL_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  // Britannian/Aurebesh/Tau hold 0.001-0.016; this allows a little more
  // slack than the strictest references without admitting the 0.10-0.19
  // free-floating drift that motivated the patch.
  const MAX_RAIL_STDDEV = 0.03;

  for (const aesthetic of AESTHETICS) {
    it(`glyph tops and bottoms share rails across the alphabet (${aesthetic})`, () => {
      for (const seedBase of RAIL_SEEDS) {
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
        const size = data.scriptStyle.viewBoxSize;
        const bounds = data.glyphs.map(inkBounds);
        const topSd = stddev(bounds.map((b) => b.top / size));
        const bottomSd = stddev(bounds.map((b) => b.bottom / size));
        expect(topSd, `top-rail stddev ${topSd.toFixed(4)} (${aesthetic}, seed ${seedBase})`).toBeLessThanOrEqual(MAX_RAIL_STDDEV);
        expect(bottomSd, `bottom-rail stddev ${bottomSd.toFixed(4)} (${aesthetic}, seed ${seedBase})`).toBeLessThanOrEqual(MAX_RAIL_STDDEV);
      }
    });
  }
});

describe("generateOrthography keeps glyph proportions in the reference band", () => {
  const SHAPE_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  for (const aesthetic of AESTHETICS) {
    it(`aspect ratio and side bearings stay within the measured envelope (${aesthetic})`, () => {
      for (const seedBase of SHAPE_SEEDS) {
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
        const { viewBoxSize: size, strokeWidth } = data.scriptStyle;
        const bounds = data.glyphs.map(inkBounds);
        const aspects = bounds.map((b) => (b.right - b.left) / Math.max(1, b.bottom - b.top));
        const meanAspect = aspects.reduce((a, b) => a + b, 0) / aspects.length;
        // Reference fonts measure 0.53-1.01; allow the full span since the
        // per-script target is drawn from a narrower band inside it.
        expect(meanAspect, `mean aspect ${meanAspect.toFixed(3)} (${aesthetic}, seed ${seedBase})`).toBeGreaterThanOrEqual(0.5);
        expect(meanAspect, `mean aspect ${meanAspect.toFixed(3)} (${aesthetic}, seed ${seedBase})`).toBeLessThanOrEqual(1.05);

        // Ink must clear the viewBox edge by at least half a stroke width,
        // or the outer half of that stroke renders clipped.
        for (const [i, b] of bounds.entries()) {
          const id = data.glyphs[i].id;
          expect(b.left, `glyph "${id}" (${aesthetic}, seed ${seedBase}) ink starts at x=${b.left.toFixed(1)}`).toBeGreaterThanOrEqual(strokeWidth / 2 - EPSILON);
          expect(b.right, `glyph "${id}" (${aesthetic}, seed ${seedBase}) ink ends at x=${b.right.toFixed(1)}`).toBeLessThanOrEqual(size - strokeWidth / 2 + EPSILON);
        }
      }
    });
  }
});

describe("generateOrthography builds every glyph on the script's shared armature", () => {
  it("the armature's own strokes appear verbatim in every glyph of a script", () => {
    for (const aesthetic of AESTHETICS) {
      for (const seedBase of [1, 42, 777, 1234]) {
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
        // "none" draws no armature strokes at all — its coherence comes from
        // the shared rails and attachment vocabulary, so there is nothing to
        // find in common here.
        if (data.scriptStyle.armature.kind === "none") continue;

        // Every glyph should contain the armature's segment endpoints. Rather
        // than reconstruct the armature geometry (an internal), assert the
        // weaker but still decisive property: all glyphs in one script share
        // a common set of stroke coordinates.
        const coordinateSets = data.glyphs.map((g) => new Set(g.strokes.flatMap(strokeCoordinates).map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)));
        const shared = coordinateSets.reduce((acc, set) => new Set([...acc].filter((key) => set.has(key))));
        expect(
          shared.size,
          `${aesthetic}/seed ${seedBase} (armature "${data.scriptStyle.armature.kind}"): glyphs share ${shared.size} coordinates — they are not built on a common skeleton`,
        ).toBeGreaterThanOrEqual(2);

        // And every glyph must actually use the script's declared vocabulary
        // rather than inventing shapes outside it.
        expect(data.scriptStyle.armature.attachments.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("a script's armature is stable across nudges", () => {
    const phonology = testPhonology(7);
    const initial = generateOrthography({
      seed: { base: 7, variation: 0 },
      params: DEFAULT_ORTHOGRAPHY_PARAMS,
      phonology,
      lexiconItems: [],
      previous: null,
      mode: "initial",
      now: FIXED_NOW,
    });
    const nudged = generateOrthography({
      seed: { base: 7, variation: 1 },
      params: DEFAULT_ORTHOGRAPHY_PARAMS,
      phonology,
      lexiconItems: [],
      previous: initial,
      mode: "nudge",
      now: FIXED_NOW,
    });
    expect(nudged.scriptStyle.armature).toEqual(initial.scriptStyle.armature);
    expect(nudged.scriptStyle.sideBearing).toBe(initial.scriptStyle.sideBearing);
    expect(nudged.scriptStyle.slant).toBe(initial.scriptStyle.slant);
  });

  it("ancestorScript steers the armature toward that family's skeleton", () => {
    // Devanagari's defining structural feature is the headline every letter
    // hangs from; picking it should produce that skeleton regardless of seed.
    for (const seedBase of [1, 2, 3, 4, 5, 6]) {
      const phonology = testPhonology(seedBase);
      const data = generateOrthography({
        seed: { base: seedBase, variation: 0 },
        params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, ancestorScript: "devanagari" },
        phonology,
        lexiconItems: [],
        previous: null,
        mode: "initial",
        now: FIXED_NOW,
      });
      expect(data.scriptStyle.armature.kind, `seed ${seedBase} with ancestorScript "devanagari"`).toBe("headline");
    }
  });
});

// Feature-driven placement cannot guarantee distinct letterforms on its own:
// place of articulation maps 11 values onto 5-7 anchor stops and manner maps
// 12 onto a 3-4 shape vocabulary, so collisions are expected by construction
// rather than exceptional. Before resolveGlyphs claimed each shape, a
// measured 19% of an average alphabet — and up to 63% of a bad one — came
// out byte-identical. An alphabet whose letters don't distinguish themselves
// is legible as a style and useless as a writing system.
//
// The syllabic and logographic sets are an order of magnitude larger (~140
// and ~500 signs against an alphabet's ~27) and get a bigger attachment
// budget to match; without it they measured 33% and 25% duplicates.

describe("generateOrthography gives every glyph in a script a distinct shape", () => {
  const DEDUP_SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);
  // Not zero: the shape space is deliberately finite, and a large glyph set
  // on a narrow seeded vocabulary can genuinely exhaust it. These ceilings
  // are well under the pre-dedup rates and are regression gates, not targets.
  const MAX_DUPLICATE_RATIO: Record<string, number> = {
    alphabetic: 0.02,
    abjad: 0.02,
    abugida: 0.02,
    syllabic: 0.08,
    logographic: 0.02,
  };

  for (const scriptCategory of SCRIPT_CATEGORIES) {
    it(`duplicate glyphs stay under the ceiling (${scriptCategory})`, () => {
      let totalRatio = 0;
      let scripts = 0;
      for (const seedBase of DEDUP_SEEDS) {
        const phonology = testPhonology(seedBase);
        const lexiconItems = testLexicon(seedBase, phonology);
        for (const aesthetic of AESTHETICS) {
          const data = generateOrthography({
            seed: { base: seedBase, variation: 0 },
            params: { ...DEFAULT_ORTHOGRAPHY_PARAMS, scriptCategory, aesthetic },
            phonology,
            lexiconItems,
            previous: null,
            mode: "initial",
            now: FIXED_NOW,
          });
          if (data.glyphs.length < 2) continue;
          const paths = data.glyphs.map((g) => glyphToSvgPath(g));
          totalRatio += 1 - new Set(paths).size / paths.length;
          scripts++;
        }
      }
      expect(scripts).toBeGreaterThan(0);
      const mean = totalRatio / scripts;
      expect(
        mean,
        `mean duplicate-glyph ratio for ${scriptCategory} = ${(mean * 100).toFixed(2)}% across ${scripts} scripts`,
      ).toBeLessThanOrEqual(MAX_DUPLICATE_RATIO[scriptCategory]);
    });
  }

  it("locked glyphs are never redrawn to resolve a collision", () => {
    const phonology = testPhonology(3);
    const initial = generateOrthography({
      seed: { base: 3, variation: 0 },
      params: DEFAULT_ORTHOGRAPHY_PARAMS,
      phonology,
      lexiconItems: [],
      previous: null,
      mode: "initial",
      now: FIXED_NOW,
    });
    // Lock two glyphs onto the SAME shape — dedup must respect the lock and
    // leave the duplicate standing rather than "fixing" user-owned data.
    const [first, second] = initial.glyphs;
    const locked = {
      ...initial,
      glyphs: initial.glyphs.map((g) =>
        g.id === first.id || g.id === second.id ? { ...g, strokes: first.strokes, locked: true } : g,
      ),
    };
    const rerolled = generateOrthography({
      seed: { base: 99, variation: 0 },
      params: DEFAULT_ORTHOGRAPHY_PARAMS,
      phonology,
      lexiconItems: [],
      previous: locked,
      mode: "reroll",
      now: FIXED_NOW,
    });
    for (const id of [first.id, second.id]) {
      const carried = rerolled.glyphs.find((g) => g.id === id);
      expect(carried?.locked).toBe(true);
      expect(carried?.strokes).toEqual(first.strokes);
    }
  });
});
