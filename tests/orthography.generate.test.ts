import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import { generateLexicon } from "../convex/lexicon/generate";
import { DEFAULT_LEXICON_PARAMS } from "../convex/lexicon/types";
import { generateOrthography } from "../convex/orthography/generate";
import { AESTHETICS, DEFAULT_ORTHOGRAPHY_PARAMS, SCRIPT_CATEGORIES } from "../convex/orthography/types";
import type { PhonologyData } from "../convex/phonology/types";
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
