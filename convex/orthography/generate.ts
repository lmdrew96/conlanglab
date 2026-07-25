// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts,
// convex/lexicon/generate.ts, convex/morphology/generate.ts,
// convex/syntax/generate.ts. Reuses convex/morphology/generate.ts's
// `isVowel`/`resolvePhonemes` directly (one canonical predicate/resolver,
// not a parallel copy) but re-implements the small local `hashString`
// FNV-1a helper locally rather than importing it — same "not exported from
// there" convention convex/syntax/generate.ts already follows.

import { Rng, deriveSeed } from "../lib/rng";
import {
  AESTHETIC_STYLE_PRESETS,
  ALL_STROKE_KINDS,
  ANCESTOR_SCRIPT_BIAS,
  BOUNDARY_TREATMENT_TABLE,
  MANNER_RADICAL_ANGLE,
  ORIENTATION_BY_PLACE,
  SECONDARY_MARK_ANGLE,
  STROKE_FAMILY_BY_MANNER,
  VOWEL_BACKNESS_X,
  VOWEL_HEIGHT_Y,
  VOWEL_STROKE_KINDS,
} from "./content";
import type {
  AncestorScriptFamily,
  Aesthetic,
  BoundaryTreatment,
  Glyph,
  GlyphKind,
  GraphemeRule,
  GraphemeRuleEnvironment,
  OrthographyParams,
  OrthographyStageData,
  OverflowStrategy,
  Point,
  ScriptCategory,
  ScriptStyle,
  Seed,
  SoundToSymbolMapping,
  Stroke,
} from "./types";
import { isVowel, resolvePhonemes } from "../morphology/generate";
import type { AssembledWord } from "../morphology/generate";
import type { AffixStrategy, MorphologyAffixData } from "../morphology/types";
import type { ConsonantPhoneme, PhonemeTier, PhonologyData, VowelHeight, VowelPhoneme } from "../phonology/types";
import type { LexiconItemData } from "../lexicon/types";

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;

/** FNV-1a — deterministic string→uint32, used to derive per-glyph seeds from the stage seed. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The stable id/lock key for a syllable/mora glyph — shared by generation, mapping, and live composition so all three always agree on the same key format. */
export function syllableGlyphId(consonantId: string | null, vowelId: string): string {
  return `${consonantId ?? "_"}+${vowelId}`;
}

const STYLE_SALT = 0xc0ffee;

/**
 * `strokeWidth`/`strokeCountRange` used to come straight off the 2-entry
 * AESTHETIC_STYLE_PRESETS table, so every script sharing an aesthetic had
 * byte-identical "visual weight" (line thickness, glyph density) — part of
 * why regenerated scripts all looked like the same font. Now derived per
 * (aesthetic, seed.base) within an aesthetic-appropriate envelope: invented
 * stays the thinner/sparser archetype and realLike the heavier/denser one
 * on average, but two scripts of the same aesthetic can still land anywhere
 * in that envelope — one bold and minimal, another thin and elaborate.
 */
export function buildScriptStyle(aesthetic: Aesthetic, seedBase: number): ScriptStyle {
  const preset = AESTHETIC_STYLE_PRESETS[aesthetic];
  const rng = new Rng(deriveSeed(seedBase, STYLE_SALT));
  const strokeWidth = aesthetic === "invented" ? rng.int(3, 6) : rng.int(2, 5);
  const strokeCountRange: [number, number] =
    aesthetic === "invented" ? [rng.int(1, 2), rng.int(3, 5)] : [rng.int(2, 3), rng.int(4, 6)];
  return { version: 1, ...preset, strokeWidth, strokeCountRange };
}

// --- Stroke composition (Section 14.2's shared grid + shared stroke vocabulary) ---

function gridX(bias: number, style: ScriptStyle, jitter: number): number {
  const margin = style.viewBoxSize * 0.15;
  const usable = style.viewBoxSize - margin * 2;
  return margin + bias * usable + jitter;
}

const GEOMETRY_SALT = 0xbeef;

/**
 * A script's own "handwriting" — jitter spread, a consistent lean direction,
 * and hook/curve size ranges — derived once per (cornerStyle, seed.base) so
 * every reroll produces a structurally distinct-looking script instead of
 * reshuffling phonemes onto an identical fixed skeleton (the "orthography
 * variety" bug: every invented/realLike script looked the same because
 * AESTHETIC_STYLE_PRESETS is a static 2-entry table and the old hardcoded
 * jitter/hook/curve constants left almost no room for seeds to differ).
 * Bounds stay envelope-appropriate per cornerStyle so "invented" always
 * reads sharper/tighter and "realLike" always reads rounder/looser — only
 * the specific numbers within that envelope vary by seed.
 */
interface GeometryProfile {
  jitterSpread: number;
  /** -1..1, a consistent per-script lean applied to every line/curve endpoint so strokes share a "handwriting angle" instead of jittering independently. */
  slant: number;
  curveBulgeRange: [number, number];
  dotScale: number;
  /**
   * 0 = this script strongly favors geometric/discrete strokes (line, dot)
   * wherever a manner's STROKE_FAMILY_BY_MANNER pool offers a choice; 1 =
   * strongly favors flowing/cursive strokes (curve, hook). Every manner pool
   * now includes at least one of each (see content.ts), so this one number
   * sweeps the whole consonant inventory — the mechanism that makes two
   * scripts of the same aesthetic read like distinct typefaces (one blocky,
   * one cursive) rather than just reshuffled letterforms.
   */
  shapeBias: number;
}

function buildGeometryProfile(
  cornerStyle: ScriptStyle["cornerStyle"],
  seedBase: number,
  ancestorScript: AncestorScriptFamily | null,
): GeometryProfile {
  const rng = new Rng(deriveSeed(seedBase, GEOMETRY_SALT));
  const rounded = cornerStyle === "rounded";
  const bias = ancestorScript ? ANCESTOR_SCRIPT_BIAS[ancestorScript] : null;
  const jitterMultiplier = bias?.jitterMultiplier ?? 1;
  const [shapeBiasMin, shapeBiasMax] = bias?.shapeBiasRange ?? [0, 1];
  return {
    jitterSpread: Math.round(rng.int(rounded ? 5 : 6, rounded ? 12 : 16) * jitterMultiplier),
    slant: rng.float() * 2 - 1,
    curveBulgeRange: rounded ? [rng.int(8, 14), rng.int(16, 28)] : [rng.int(2, 6), rng.int(7, 14)],
    dotScale: rng.float() * 0.6 + 0.8,
    shapeBias: shapeBiasMin + rng.float() * (shapeBiasMax - shapeBiasMin),
  };
}

const FLOWING_STROKE_KINDS = new Set<Stroke["kind"]>(["curve", "hook"]);

/** Picks a stroke kind from an allowed pool, weighted by the script's shapeBias — a no-op when the pool has only one option (most manners still constrain to a fixed family; this only decides which member of a mixed family gets favored). */
function pickStrokeKind(kinds: readonly Stroke["kind"][], geometry: GeometryProfile, rng: Rng): Stroke["kind"] {
  if (kinds.length === 1) return kinds[0];
  return rng.weightedPick(kinds, (kind) => (FLOWING_STROKE_KINDS.has(kind) ? geometry.shapeBias : 1 - geometry.shapeBias));
}

/**
 * Vowel height was previously computed (VOWEL_HEIGHT_Y) but never actually
 * consulted when placing a vowel's stroke — every vowel glyph drew across
 * the full x-height→baseline span regardless of height, so vowels sharing a
 * backness (most of them) rendered near-identically. This maps height onto
 * a real sub-band of the available vertical range; `height: null` (used by
 * consonants/concepts, which have no height feature) keeps the full band.
 */
function heightBand(height: VowelHeight | null, top: number, bottom: number): [number, number] {
  if (height === null) return [top, bottom];
  const span = bottom - top;
  const center = top + VOWEL_HEIGHT_Y[height] * span;
  const half = span * 0.22;
  return [Math.max(top, center - half), Math.min(bottom, center + half)];
}

const GRID_COLS = 3;
const GRID_ROWS = 4;
const FOOTPRINT_HALF_WIDTH_FRACTION = 0.22;

/**
 * A glyph's local anchor grid (3 columns x 4 rows) — every stroke endpoint
 * snaps to one of these points instead of landing at a continuously
 * jittered coordinate. This is the "text, not handwriting" fix: real
 * constructed scripts (and real typefaces generally) build every letter
 * from a small shared set of crisp aligned positions; they never wobble
 * each line segment independently the way the old per-endpoint jitter did.
 * `slant` shifts the whole grid's column once per script (buildLocalGrid's
 * one jitterSpread nudge) rather than per stroke, so a script can still
 * lean without any individual stroke looking shaky.
 */
function buildLocalGrid(xBias: number, yBand: [number, number], style: ScriptStyle, geometry: GeometryProfile): Point[][] {
  const [yTop, yBottom] = yBand;
  const centerX = gridX(xBias, style, geometry.slant * geometry.jitterSpread);
  const half = style.viewBoxSize * FOOTPRINT_HALF_WIDTH_FRACTION;
  const cols = [centerX - half, centerX, centerX + half];
  const rows = Array.from({ length: GRID_ROWS }, (_, i) => yTop + ((yBottom - yTop) * i) / (GRID_ROWS - 1));
  return rows.map((y) => cols.map((x) => ({ x, y })));
}

interface GridCursor {
  row: number;
  col: number;
  point: Point;
}

const ORTHOGONAL_MOVE_CHANCE = 0.75;

/**
 * Enumerates every other grid point, split into "orthogonal" (shares a row
 * or column with `exclude` — produces a clean vertical or horizontal
 * stroke) and "diagonal" (shares neither). Heavily biased toward
 * orthogonal: real constructed scripts build letters almost entirely from
 * verticals/horizontals meeting at corners, with diagonals used sparingly
 * as an accent, not as the dominant connector. Without this bias, uniform
 * random picking constantly draws corner-to-corner diagonals that cross
 * through the glyph — the reason grid-snapped strokes still read as
 * chaotic scribbles instead of clean blocky letters.
 */
function pickGridPoint(grid: Point[][], rng: Rng, exclude: GridCursor): GridCursor {
  const orthogonal: GridCursor[] = [];
  const diagonal: GridCursor[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (row === exclude.row && col === exclude.col) continue;
      (row === exclude.row || col === exclude.col ? orthogonal : diagonal).push({ row, col, point: grid[row][col] });
    }
  }
  const pool = orthogonal.length > 0 && rng.chance(ORTHOGONAL_MOVE_CHANCE) ? orthogonal : diagonal;
  return rng.pick(pool.length > 0 ? pool : orthogonal);
}

const CLOSURE_CHANCE = 0.3;

/**
 * Builds `count` strokes that read as ONE constructed glyph, grid-snapped
 * (buildLocalGrid) rather than freely jittered. Two extra rules make it
 * read as text rather than a doodle: the chain always touches the bottom
 * grid row (the shared baseline every letter in a real typeface sits on)
 * at least once, and — once grounded — the final stroke sometimes targets
 * the glyph's own starting point instead of a fresh one, closing the shape
 * into a box/loop/triangle the way real constructed scripts constantly do
 * and the old free-form chain could never produce.
 */
interface ConnectedStrokes {
  strokes: Stroke[];
  /** The chain's own first point — literally `strokes[0]`'s from/anchor/center. Callers anchor near-top decorative marks here so they share a real coordinate with the chain instead of an independently computed one. */
  start: Point;
  /** The chain's own last point — literally the final stroke's to/center. Callers anchor near-bottom decorative marks (e.g. the manner radical) here. */
  end: Point;
}

function buildConnectedStrokes(
  kinds: readonly Stroke["kind"][],
  count: number,
  xBias: number,
  yBand: [number, number],
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
): ConnectedStrokes {
  const grid = buildLocalGrid(xBias, yBand, style, geometry);
  const startCol = geometry.slant < -0.33 ? 0 : geometry.slant > 0.33 ? GRID_COLS - 1 : 1;
  const start: GridCursor = { row: 0, col: startCol, point: grid[0][startCol] };

  let cursor = start;
  let grounded = false;
  const strokes: Stroke[] = [];

  for (let i = 0; i < count; i++) {
    const kind = pickStrokeKind(kinds, geometry, rng);
    const isFinal = i === count - 1;
    const closing = isFinal && i > 0 && grounded && rng.chance(CLOSURE_CHANCE);

    // A dot has one coordinate, not a span — it decorates the pen's current
    // position rather than moving to a freshly picked point. Advancing it to
    // an unrelated grid point (like line/curve/hook do) would silently
    // "teleport" it with nothing drawn in between, reproducing the exact
    // disconnected-mark bug this function exists to prevent.
    let target = closing ? start : kind === "dot" ? cursor : pickGridPoint(grid, rng, cursor);
    if (isFinal && !grounded && kind !== "dot") target = { row: GRID_ROWS - 1, col: target.col, point: grid[GRID_ROWS - 1][target.col] };
    if (target.row === GRID_ROWS - 1) grounded = true;

    const from = cursor.point;
    const to = target.point;
    let stroke: Stroke;
    switch (kind) {
      case "line":
        stroke = { kind: "line", from, to };
        break;
      case "curve": {
        const [bulgeMin, bulgeMax] = geometry.curveBulgeRange;
        const bulge = rng.int(bulgeMin, bulgeMax) * (rng.chance(0.5) ? 1 : -1);
        stroke = { kind: "curve", from, control: { x: (from.x + to.x) / 2 + bulge, y: (from.y + to.y) / 2 }, to };
        break;
      }
      case "dot":
        stroke = { kind: "dot", center: to, radius: style.strokeWidth * geometry.dotScale };
        break;
      case "hook": {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const [curvMin, curvMax] = geometry.curveBulgeRange;
        stroke = {
          kind: "hook",
          anchor: from,
          angle: (Math.atan2(dy, dx) * 180) / Math.PI,
          length: Math.max(4, Math.hypot(dx, dy)),
          curvature: rng.int(curvMin, curvMax) * (rng.chance(0.5) ? 1 : -1),
        };
        break;
      }
    }
    strokes.push(stroke);
    cursor = target;
  }
  return { strokes, start: start.point, end: cursor.point };
}

/** Overflow phonemes (diacriticStacking strategy) get one guaranteed extra mark layered on their otherwise-normal glyph, flagging them as the "added-on" tier. Placed exactly at the chain's own `start` (not an independent gridX/baselineY coordinate) so it shares a literal coordinate with the main letterform instead of floating disconnected from it. */
function buildOverflowMark(anchor: Point, style: ScriptStyle): Stroke {
  return { kind: "dot", center: anchor, radius: style.strokeWidth * 0.6 };
}

/**
 * A fixed, non-random tick keyed only by manner (MANNER_RADICAL_ANGLE) —
 * every consonant sharing a manner gets the exact same tiny mark,
 * regardless of which stroke kind shapeBias picked for its main strokes.
 * Starts exactly at the connected chain's own `end` point (its last
 * stroke's literal to/center coordinate) instead of an independently
 * computed gridX/baselineY coordinate, then extends outward at its own
 * angle — reads as an attached flourish off the letterform, not a second,
 * unrelated floating stroke (the actual mechanism this patch fixes; the
 * chain itself was already correctly connected before this change, but
 * every consonant unconditionally got this radical appended disconnected).
 */
function buildMannerRadical(manner: ConsonantPhoneme["features"]["manner"], anchor: Point, style: ScriptStyle): Stroke {
  const angleRad = (MANNER_RADICAL_ANGLE[manner] * Math.PI) / 180;
  const length = style.viewBoxSize * 0.08;
  return { kind: "line", from: anchor, to: { x: anchor.x + Math.cos(angleRad) * length, y: anchor.y + Math.sin(angleRad) * length } };
}

function buildConsonantStrokes(
  phoneme: ConsonantPhoneme,
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
  markOverflow = false,
): Stroke[] {
  const family = STROKE_FAMILY_BY_MANNER[phoneme.features.manner];
  const xBias = ORIENTATION_BY_PLACE[phoneme.features.place];
  const yBand: [number, number] = [style.xHeightY, style.baselineY];
  const [minStrokes, maxStrokes] = style.strokeCountRange;
  const { strokes, start, end } = buildConnectedStrokes(family, rng.int(minStrokes, maxStrokes), xBias, yBand, style, geometry, rng);
  strokes.push(buildMannerRadical(phoneme.features.manner, end, style));
  if (phoneme.features.voiced) {
    strokes.push({ kind: "dot", center: { x: start.x + 8, y: start.y - 6 }, radius: style.strokeWidth });
  }
  if (phoneme.features.secondary) {
    const angle = SECONDARY_MARK_ANGLE[phoneme.features.secondary];
    strokes.push({ kind: "hook", anchor: start, angle, length: 8, curvature: 10 });
  }
  if (markOverflow) strokes.push(buildOverflowMark(start, style));
  return strokes;
}

function buildVowelStrokes(
  phoneme: VowelPhoneme,
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
  markOverflow = false,
): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const yBand = heightBand(phoneme.features.height, style.xHeightY, style.baselineY);
  const count = Math.max(1, style.strokeCountRange[0] - 1);
  const { strokes, start, end } = buildConnectedStrokes(VOWEL_STROKE_KINDS, count, xBias, yBand, style, geometry, rng);
  // Anchored exactly at `end` (epsilon 0): unlike consonants, vowels have no
  // unconditional decorative mark (no manner radical) to guarantee the
  // connectivity contract on its own, so when this is the only extra stroke
  // it must itself land on a literal chain coordinate.
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: end, radius: style.strokeWidth });
  }
  if (markOverflow) strokes.push(buildOverflowMark(start, style));
  return strokes;
}

/** A smaller mark in the ascender band above x-height, composed onto a base consonant glyph at word-composition time rather than stored as part of it (abugida vowel diacritics). Previously drew its primary stroke across the same full x-height→baseline band as a consonant (the ascender-band placement only ever applied to the optional rounding dot) — now the primary stroke itself lives in the ascender band, keyed by height, so diacritics actually read as a small mark riding above the base glyph. */
function buildVowelDiacriticStrokes(phoneme: VowelPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const ascenderTop = style.xHeightY * 0.15;
  const ascenderBottom = style.xHeightY * 0.9;
  const yBand = heightBand(phoneme.features.height, ascenderTop, ascenderBottom);
  const { strokes, end } = buildConnectedStrokes(VOWEL_STROKE_KINDS, 1, xBias, yBand, style, geometry, rng);
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: end, radius: style.strokeWidth * 0.8 });
  }
  return strokes;
}

function buildSyllableStrokes(
  consonantId: string | null,
  vowelId: string,
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
): Stroke[] {
  const vowel = phonology.vowels.find((v) => v.id === vowelId);
  if (!vowel) return [];
  const vowelStrokes = buildVowelStrokes(vowel, style, geometry, rng);
  const consonant = consonantId ? phonology.consonants.find((c) => c.id === consonantId) : undefined;
  if (!consonant) return vowelStrokes;
  return [...buildConsonantStrokes(consonant, style, geometry, rng), ...vowelStrokes];
}

/** Logographic glyphs have no phoneme features to key off — composed from the full stroke vocabulary across the whole grid instead of a manner/place-constrained family. */
function buildConceptStrokes(style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const yBand: [number, number] = [style.xHeightY, style.baselineY];
  const count = rng.int(style.strokeCountRange[0], style.strokeCountRange[1] + 1);
  const xBias = rng.float();
  return buildConnectedStrokes(ALL_STROKE_KINDS, count, xBias, yBand, style, geometry, rng).strokes;
}

const PREVIEW_SAMPLE_COUNT = 4;
const PREVIEW_SALT = 0xfeed;

/**
 * A handful of representative sample glyphs for a (scriptCategory,
 * aesthetic) combination — used by the pre-generation script-picker
 * (Section 9.5) to show what a script would look like without generating
 * (or persisting) the full glyph set. Only needs Phonology, which is
 * already a hard requirement by the time this stage's UI is reachable at
 * all; syllabic/logographic samples use placeholder ids rather than real
 * attested syllables/concepts, since the full lexicon-derived set isn't
 * being computed here — this is a style preview, not a mapping preview.
 * Returns `style` alongside `glyphs` (rather than a bare Glyph[]) because
 * ScriptStyle is now seed-derived (stroke width, count range, connector bar
 * position) — a caller that rebuilt its own style from just `aesthetic`
 * would render these glyphs' baked-in coordinates against a mismatched
 * viewBox/stroke-width, so the exact style used at generation time has to
 * travel with them.
 */
export function sampleGlyphs(
  params: OrthographyParams,
  phonology: PhonologyData,
  seedBase: number,
): { style: ScriptStyle; glyphs: Glyph[] } {
  const previewSeedBase = deriveSeed(seedBase, hashString(`${params.scriptCategory}:${params.aesthetic}`) ^ PREVIEW_SALT);
  const style = buildScriptStyle(params.aesthetic, previewSeedBase);
  const geometry = buildGeometryProfile(style.cornerStyle, previewSeedBase, params.ancestorScript);
  const rng = new Rng(previewSeedBase);
  const placeholderSeed: Seed = { base: previewSeedBase, variation: 0 };

  const glyphs: Glyph[] = (() => {
    switch (params.scriptCategory) {
      case "alphabetic":
      case "abjad": {
        return phonology.consonants.slice(0, PREVIEW_SAMPLE_COUNT).map((c) => ({
          id: c.id,
          kind: "consonant" as const,
          strokes: buildConsonantStrokes(c, style, geometry, rng),
          seed: placeholderSeed,
          locked: false,
        }));
      }
      case "abugida": {
        const consonant = phonology.consonants[0];
        const vowel = phonology.vowels[0];
        if (!consonant || !vowel) return [];
        return [
          {
            id: consonant.id,
            kind: "consonant" as const,
            strokes: buildConsonantStrokes(consonant, style, geometry, rng),
            seed: placeholderSeed,
            locked: false,
          },
          {
            id: `diacritic:${vowel.id}`,
            kind: "vowelDiacritic" as const,
            strokes: buildVowelDiacriticStrokes(vowel, style, geometry, rng),
            seed: placeholderSeed,
            locked: false,
          },
        ];
      }
      case "syllabic": {
        const consonantId = phonology.consonants[0]?.id ?? null;
        return phonology.vowels
          .slice(0, PREVIEW_SAMPLE_COUNT)
          .map((v) => buildGlyphForSyllable(consonantId, v.id, phonology, style, previewSeedBase, params.ancestorScript));
      }
      case "logographic": {
        return Array.from({ length: PREVIEW_SAMPLE_COUNT }, (_, i) => ({
          id: `preview:${i}`,
          kind: "concept" as const,
          strokes: buildConceptStrokes(style, geometry, rng),
          seed: placeholderSeed,
          locked: false,
        }));
      }
    }
  })();

  return { style, glyphs };
}

// --- Attested syllable extraction (Section 8.1's syllabic-category scope) ---

export interface AttestedSyllable {
  consonantId: string | null;
  vowelId: string;
}

/**
 * Bounds the syllabary to the CV/V moras actually attested in generated
 * Lexicon roots, not the full theoretical consonant×vowel cross product —
 * a syllable not yet materialized here can still be built on demand via
 * `buildGlyphForSyllable` (this app's "compose live, don't cache" idiom).
 * Complex onset clusters collapse to their nucleus-adjacent consonant and
 * codas are dropped (open-syllable moras only, matching how real
 * syllabaries like hiragana work) — a deliberate v1 simplification.
 * "derived" items are skipped: their assembled `phonologicalForm` has no
 * dot delimiters to parse syllable boundaries from (core/flexible/compound
 * items do — see convex/lexicon/generate.ts's buildRoot/buildCompoundItem).
 */
export function extractAttestedSyllables(lexiconItems: LexiconItemData[], phonology: PhonologyData): AttestedSyllable[] {
  const seen = new Map<string, AttestedSyllable>();
  for (const item of lexiconItems) {
    if (item.kind === "derived") continue;
    const resolved = resolvePhonemes(item.phonemeIds, phonology);
    if (!resolved) continue;

    const syllableStrings = item.phonologicalForm.split(".").map((s) => s.replace(/ˈ/g, ""));
    let cursor = 0;
    for (const syll of syllableStrings) {
      const group: Array<ConsonantPhoneme | VowelPhoneme> = [];
      let acc = "";
      while (acc.length < syll.length && cursor < resolved.length) {
        const p = resolved[cursor];
        acc += p.ipa;
        group.push(p);
        cursor++;
      }
      if (acc !== syll) continue; // malformed/mismatched — skip rather than guess

      const vowelIdx = group.findIndex(isVowel);
      if (vowelIdx === -1) continue;
      const onset = vowelIdx > 0 ? group[vowelIdx - 1] : undefined;
      const consonantId = onset && !isVowel(onset) ? onset.id : null;
      const vowelId = (group[vowelIdx] as VowelPhoneme).id;
      const key = syllableGlyphId(consonantId, vowelId);
      if (!seen.has(key)) seen.set(key, { consonantId, vowelId });
    }
  }
  return Array.from(seen.values());
}

/** Pure, callable at any time — a syllable not yet in the stored `glyphs[]` array (e.g. one a fresh affix attachment creates) is "not yet materialized," not "unmapped." */
export function buildGlyphForSyllable(
  consonantId: string | null,
  vowelId: string,
  phonology: PhonologyData,
  style: ScriptStyle,
  seedBase: number,
  ancestorScript: AncestorScriptFamily | null,
): Glyph {
  const id = syllableGlyphId(consonantId, vowelId);
  const seed: Seed = { base: deriveSeed(seedBase, hashString(id)), variation: 0 };
  const rng = new Rng(deriveSeed(seed.base, seed.variation));
  const geometry = buildGeometryProfile(style.cornerStyle, seedBase, ancestorScript);
  return {
    id,
    kind: "syllable",
    strokes: buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
    seed,
    locked: false,
  };
}

// --- Glyph-set resolution (per script category, with locked-carryover/nudge-keep) ---

interface GlyphPlan {
  id: string;
  kind: GlyphKind;
  build: (rng: Rng) => Stroke[];
}

interface PlanResult {
  plan: GlyphPlan[];
  /** "always"-environment digraph rules from overflowStrategy="digraph" — phonemes here have no dedicated glyph in `plan`, only a rule. */
  rules: GraphemeRule[];
}

// --- Overflow strategy (OrthographyParams.overflowStrategy) ---

/** Base per-category glyph budget "extendedInventory" ignores — evokes a Latin-sized alphabet (~20 consonant letters, ~10 vowel letters) as the point past which a script needs an overflow strategy at all. */
const CONSONANT_GLYPH_BUDGET = 20;
const VOWEL_GLYPH_BUDGET = 10;
const DIGRAPH_SALT = 0x0d19ab;

const PHONEME_TIER_RANK: Record<PhonemeTier, number> = { core: 0, common: 1, marked: 2 };

/** Splits by budget with core/common tier phonemes preferred in-budget and marked (rarer) ones overflowing first — matches the intuition that a script's base letters cover the common inventory and exotic additions are what run out of room. Stable within a tier (catalog order preserved). */
function splitByBudget<T extends { tier: PhonemeTier }>(items: T[], budget: number): { inBudget: T[]; overflow: T[] } {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PHONEME_TIER_RANK[a.item.tier] - PHONEME_TIER_RANK[b.item.tier] || a.index - b.index)
    .map(({ item }) => item);
  return { inBudget: sorted.slice(0, budget), overflow: sorted.slice(budget) };
}

/** "digraph" overflow rule: an overflow phoneme borrows a deterministic pair of DISTINCT in-budget glyph ids as its spelling, everywhere ("always") — like English "th"/"sh" reusing existing letters rather than inventing a new one. */
function buildDigraphRules(overflow: Array<{ id: string }>, inBudgetIds: string[], seedBase: number): GraphemeRule[] {
  if (inBudgetIds.length < 2) return [];
  return overflow.map(({ id }) => {
    const rng = new Rng(deriveSeed(seedBase, hashString(`digraph:${id}`) ^ DIGRAPH_SALT));
    const first = rng.pick(inBudgetIds);
    let second = rng.pick(inBudgetIds);
    for (let guard = 0; second === first && guard < 10; guard++) second = rng.pick(inBudgetIds);
    return { phonemeId: id, environment: "always" as const, glyphIds: [first, second] };
  });
}

/**
 * Applies overflowStrategy to one phoneme set (consonants, or vowels for
 * alphabetic): "extendedInventory" (v1's default, and any set that fits the
 * budget regardless of strategy) gives every phoneme a dedicated glyph plan
 * entry, uncapped. "digraph" caps at `budget` and gives overflow phonemes a
 * rule instead of a glyph. "diacriticStacking" also caps at `budget` but
 * still builds a glyph for every phoneme — `buildPlan`'s `markOverflow` flag
 * tells overflow entries to render with one extra guaranteed mark.
 */
function planWithOverflow<T extends { id: string; tier: PhonemeTier }>(
  items: T[],
  budget: number,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
  buildPlan: (item: T, markOverflow: boolean) => GlyphPlan,
): PlanResult {
  if (overflowStrategy === "extendedInventory" || items.length <= budget) {
    return { plan: items.map((item) => buildPlan(item, false)), rules: [] };
  }
  const { inBudget, overflow } = splitByBudget(items, budget);
  if (overflowStrategy === "digraph") {
    return {
      plan: inBudget.map((item) => buildPlan(item, false)),
      rules: buildDigraphRules(
        overflow,
        inBudget.map((i) => i.id),
        seedBase,
      ),
    };
  }
  return {
    plan: [...inBudget.map((item) => buildPlan(item, false)), ...overflow.map((item) => buildPlan(item, true))],
    rules: [],
  };
}

// --- Orthographic depth (OrthographyParams.orthographicDepth) ---

const DEPTH_SALT = 0x0d3974;
const DEPTH_ENVIRONMENTS: Exclude<GraphemeRuleEnvironment, "always">[] = ["wordInitial", "wordMedial", "wordFinal"];

/**
 * depth 0 = pure 1:1 mapping (today's v1 behavior, unchanged). Higher depth
 * gives a random subset of otherwise-regular phonemes (proportional to
 * depth, up to ~30% at depth 1) a positional irregularity: in one
 * environment, that phoneme borrows a DIFFERENT phoneme's existing glyph
 * instead of its own — a "homograph" pattern (English's inconsistent
 * digraphs/silent letters, Spanish's near-total absence of this). Only
 * phonemes that already have a dedicated glyph are eligible — overflow
 * phonemes get their irregularity from overflowStrategy instead, never
 * both (the two mechanisms are kept disjoint by construction).
 */
function buildDepthRules(candidateIds: string[], depth: number, seedBase: number): GraphemeRule[] {
  if (depth <= 0 || candidateIds.length < 2) return [];
  const rng = new Rng(deriveSeed(seedBase, DEPTH_SALT));
  const count = Math.round(depth * 0.3 * candidateIds.length);
  const chosen = rng.shuffle(candidateIds).slice(0, count);
  return chosen.map((phonemeId) => {
    const environment = rng.pick(DEPTH_ENVIRONMENTS);
    const others = candidateIds.filter((id) => id !== phonemeId);
    return { phonemeId, environment, glyphIds: [rng.pick(others)] };
  });
}

/** Depth rules only ever borrow within the same plan-entry kind (a consonant borrows another consonant's glyph, a vowel another vowel's) — separate seeded draws per kind keep that partition without depth rules and overflow rules colliding on the same phoneme. */
function buildDepthRulesForPlan(plan: GlyphPlan[], depth: number, seedBase: number): GraphemeRule[] {
  const consonantIds = plan.filter((p) => p.kind === "consonant").map((p) => p.id);
  const vowelIds = plan.filter((p) => p.kind === "vowel").map((p) => p.id);
  return [
    ...buildDepthRules(consonantIds, depth, deriveSeed(seedBase, hashString("depth:consonant"))),
    ...buildDepthRules(vowelIds, depth, deriveSeed(seedBase, hashString("depth:vowel"))),
  ];
}

function alphabeticPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  const consonants = planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
  const vowels = planWithOverflow(phonology.vowels, VOWEL_GLYPH_BUDGET, overflowStrategy, seedBase, (v, markOverflow) => ({
    id: v.id,
    kind: "vowel" as const,
    build: (rng: Rng) => buildVowelStrokes(v, style, geometry, rng, markOverflow),
  }));
  return { plan: [...consonants.plan, ...vowels.plan], rules: [...consonants.rules, ...vowels.rules] };
}

function abjadPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  return planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
}

/** Vowel diacritics never overflow — they're cheap marks modifying a base consonant, not competing "letters," so unlike the consonant side there's no budget cap here regardless of overflowStrategy. */
function abugidaPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  const consonants = planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
  const vowelPlan: GlyphPlan[] = phonology.vowels.map((v) => ({
    id: `diacritic:${v.id}`,
    kind: "vowelDiacritic" as const,
    build: (rng: Rng) => buildVowelDiacriticStrokes(v, style, geometry, rng),
  }));
  return { plan: [...consonants.plan, ...vowelPlan], rules: consonants.rules };
}

function syllabicPlan(
  phonology: PhonologyData,
  lexiconItems: LexiconItemData[],
  style: ScriptStyle,
  geometry: GeometryProfile,
): PlanResult {
  const plan = extractAttestedSyllables(lexiconItems, phonology).map(({ consonantId, vowelId }) => ({
    id: syllableGlyphId(consonantId, vowelId),
    kind: "syllable" as const,
    build: (rng: Rng) => buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
  }));
  return { plan, rules: [] };
}

function logographicPlan(lexiconItems: LexiconItemData[], style: ScriptStyle, geometry: GeometryProfile): PlanResult {
  const plan = lexiconItems.map((item) => ({
    id: item.id,
    kind: "concept" as const,
    build: (rng: Rng) => buildConceptStrokes(style, geometry, rng),
  }));
  return { plan, rules: [] };
}

function resolveGlyphs(
  plan: GlyphPlan[],
  seed: Seed,
  previousById: Map<string, Glyph>,
  mode: "initial" | "reroll" | "nudge",
  rng: Rng,
  keepProbability: number,
): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const planned of plan) {
    const prev = previousById.get(planned.id);
    if (prev?.locked) {
      glyphs.push(prev);
      continue;
    }
    if (mode === "nudge" && prev && rng.chance(keepProbability)) {
      glyphs.push(prev);
      continue;
    }

    const itemSeed: Seed =
      mode === "nudge" && prev
        ? { base: prev.seed.base, variation: prev.seed.variation + 1 }
        : { base: deriveSeed(seed.base, hashString(planned.id)), variation: 0 };
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    glyphs.push({ id: planned.id, kind: planned.kind, strokes: planned.build(itemRng), seed: itemSeed, locked: false });
  }
  return glyphs;
}

function buildMapping(category: ScriptCategory, glyphs: Glyph[], rules: GraphemeRule[]): SoundToSymbolMapping {
  switch (category) {
    case "alphabetic": {
      const phonemeToGlyph: Record<string, string> = {};
      for (const g of glyphs) phonemeToGlyph[g.id] = g.id;
      return { kind: "alphabetic", phonemeToGlyph, rules };
    }
    case "abjad": {
      const consonantToGlyph: Record<string, string> = {};
      for (const g of glyphs) consonantToGlyph[g.id] = g.id;
      return { kind: "abjad", consonantToGlyph, rules };
    }
    case "abugida": {
      const baseConsonantToGlyph: Record<string, string> = {};
      const vowelToDiacritic: Record<string, string> = {};
      for (const g of glyphs) {
        if (g.kind === "vowelDiacritic") vowelToDiacritic[g.id.replace(/^diacritic:/, "")] = g.id;
        else baseConsonantToGlyph[g.id] = g.id;
      }
      return { kind: "abugida", baseConsonantToGlyph, vowelToDiacritic, rules };
    }
    case "syllabic": {
      const syllableToGlyph: Record<string, string> = {};
      for (const g of glyphs) syllableToGlyph[g.id] = g.id;
      return { kind: "syllabic", syllableToGlyph };
    }
    case "logographic": {
      const conceptToGlyph: Record<string, string> = {};
      for (const g of glyphs) conceptToGlyph[g.id] = g.id;
      return { kind: "logographic", conceptToGlyph };
    }
  }
}

export interface GenerateOrthographyArgs {
  seed: Seed;
  params: OrthographyParams;
  phonology: PhonologyData;
  /** Only consulted for the syllabic/logographic categories — safe to pass [] otherwise. */
  lexiconItems: LexiconItemData[];
  previous: OrthographyStageData | null;
  mode: "initial" | "reroll" | "nudge";
  now: number;
  nudgeKeepProbability?: number;
}

export function generateOrthography(args: GenerateOrthographyArgs): OrthographyStageData {
  const { seed, params, phonology, lexiconItems, previous, mode, now } = args;
  const keepProbability = args.nudgeKeepProbability ?? DEFAULT_NUDGE_KEEP_PROBABILITY;
  const rng = new Rng(mode === "nudge" ? deriveSeed(seed.base, seed.variation) : seed.base);

  // A nudge never touches the shared grid — only reroll/param-change does,
  // so mid-script "flavor" tweaks never fight the script's own coherence.
  const scriptStyle = mode === "nudge" && previous ? previous.scriptStyle : buildScriptStyle(params.aesthetic, seed.base);
  // Geometry is a pure function of (cornerStyle, seed.base, ancestorScript),
  // and nudge keeps seed.base/ancestorScript fixed (only variation advances)
  // — so this stays stable across nudges for the same reason scriptStyle
  // does, without needing its own nudge/reroll branch.
  const geometry = buildGeometryProfile(scriptStyle.cornerStyle, seed.base, params.ancestorScript);

  const previousGlyphsById = new Map((previous?.glyphs ?? []).map((g) => [g.id, g] as const));

  const planResult: PlanResult =
    params.scriptCategory === "alphabetic"
      ? alphabeticPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
      : params.scriptCategory === "abjad"
        ? abjadPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
        : params.scriptCategory === "abugida"
          ? abugidaPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
          : params.scriptCategory === "syllabic"
            ? syllabicPlan(phonology, lexiconItems, scriptStyle, geometry)
            : logographicPlan(lexiconItems, scriptStyle, geometry);

  const glyphs = resolveGlyphs(planResult.plan, seed, previousGlyphsById, mode, rng, keepProbability);
  const depthRules = buildDepthRulesForPlan(planResult.plan, params.orthographicDepth, seed.base);
  const mapping = buildMapping(params.scriptCategory, glyphs, [...planResult.rules, ...depthRules]);

  return { version: 1, seed, params, scriptStyle, glyphs, mapping, generatedAt: now };
}

// --- Boundary rendering (Section 8.3) — resolved live, never persisted ---

export function resolveBoundaryTreatment(strategy: AffixStrategy, aesthetic: Aesthetic): BoundaryTreatment {
  return BOUNDARY_TREATMENT_TABLE[aesthetic][strategy];
}

interface GraphemeGroup {
  start: number;
  end: number;
  glyphId: string;
  diacriticGlyphId?: string;
  /** Additional glyphs rendered right after `glyphId`, same phoneme span — a GraphemeRule's digraph/homograph substitution, not a separate morpheme. */
  extraGlyphIds?: string[];
}

function wordEnvironment(index: number, length: number): Exclude<GraphemeRuleEnvironment, "always"> {
  if (index === 0) return "wordInitial";
  if (index === length - 1) return "wordFinal";
  return "wordMedial";
}

/** Depth/overflow irregularity lookup — an "always" rule (digraph overflow) matches regardless of position; a positional rule (depth irregularity) only matches its own environment. Rule generation keeps these disjoint per phoneme (see buildDepthRules/buildDigraphRules), so at most one rule ever matches. */
function findGraphemeRule(rules: GraphemeRule[] | undefined, phonemeId: string, index: number, length: number): GraphemeRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  const env = wordEnvironment(index, length);
  return rules.find((r) => r.phonemeId === phonemeId && (r.environment === "always" || r.environment === env));
}

/** Resolves a phoneme to the glyph id sequence it actually renders as — its plain mapped glyph, or a rule's borrowed/digraph sequence when one applies. */
function resolvePhonemeGlyphIds(
  defaultGlyphId: string,
  phonemeId: string,
  index: number,
  length: number,
  rules: GraphemeRule[] | undefined,
): string[] {
  const rule = findGraphemeRule(rules, phonemeId, index, length);
  return rule ? rule.glyphIds : [defaultGlyphId];
}

function groupIntoGraphemes(resolved: Array<ConsonantPhoneme | VowelPhoneme>, mapping: SoundToSymbolMapping): GraphemeGroup[] {
  const groups: GraphemeGroup[] = [];
  // Logographic scripts render a whole word as one concept glyph — there's
  // no per-phoneme grapheme story to walk, so boundary composition simply
  // doesn't apply (see boundary-preview-panel's scope note).
  if (mapping.kind === "logographic") return groups;

  if (mapping.kind === "alphabetic") {
    resolved.forEach((p, i) => {
      const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(mapping.phonemeToGlyph[p.id] ?? p.id, p.id, i, resolved.length, mapping.rules);
      groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
    });
    return groups;
  }

  if (mapping.kind === "abjad") {
    resolved.forEach((p, i) => {
      if (isVowel(p)) return;
      const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(
        mapping.consonantToGlyph[p.id] ?? p.id,
        p.id,
        i,
        resolved.length,
        mapping.rules,
      );
      groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
    });
    return groups;
  }

  if (mapping.kind === "abugida") {
    let i = 0;
    while (i < resolved.length) {
      const p = resolved[i];
      if (!isVowel(p)) {
        const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(
          mapping.baseConsonantToGlyph[p.id] ?? p.id,
          p.id,
          i,
          resolved.length,
          mapping.rules,
        );
        const next = resolved[i + 1];
        if (next && isVowel(next)) {
          groups.push({
            start: i,
            end: i + 2,
            glyphId,
            extraGlyphIds,
            diacriticGlyphId: mapping.vowelToDiacritic[next.id],
          });
          i += 2;
          continue;
        }
        groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
        i += 1;
        continue;
      }
      // A bare vowel with no preceding consonant carrier — render its diacritic standalone.
      groups.push({ start: i, end: i + 1, glyphId: mapping.vowelToDiacritic[p.id] ?? p.id });
      i += 1;
    }
    return groups;
  }

  // syllabic
  let i = 0;
  while (i < resolved.length) {
    const p = resolved[i];
    if (isVowel(p)) {
      const id = syllableGlyphId(null, p.id);
      groups.push({ start: i, end: i + 1, glyphId: mapping.syllableToGlyph[id] ?? id });
      i += 1;
      continue;
    }
    const next = resolved[i + 1];
    if (next && isVowel(next)) {
      const id = syllableGlyphId(p.id, next.id);
      groups.push({ start: i, end: i + 2, glyphId: mapping.syllableToGlyph[id] ?? id });
      i += 2;
      continue;
    }
    // A leftover coda consonant with no following vowel — this app's
    // syllabaries cover open CV/V moras only (see extractAttestedSyllables),
    // so it has no glyph; skip it (v1 scope cut).
    i += 1;
  }
  return groups;
}

export interface GlyphSequenceStep {
  glyphId: string;
  /** abugida only: a vowel diacritic composed onto glyphId. */
  diacriticGlyphId?: string;
  /** A GraphemeRule's digraph/homograph substitution — additional glyphs rendered right after glyphId, same phoneme, no junction between them. */
  extraGlyphIds?: string[];
  junctionBefore: BoundaryTreatment | null;
}

export interface ComposedWord {
  steps: GlyphSequenceStep[];
  /**
   * Set when an ablaut/templatic affix modified the word in place. Those
   * strategies leave no clean per-phoneme junction to anchor a per-step
   * marker at (see convex/morphology/types.ts's WordSegment comment), so the
   * UI renders this as a whole-word annotation instead of attaching it to
   * one glyph.
   */
  nonSegmentalTreatment: BoundaryTreatment | null;
}

/**
 * The live, boundary-aware word→glyph-sequence composer — never persisted,
 * same "compose live, don't cache" idiom as convex/syntax/generate.ts's
 * buildExampleSentences. `affixesUsed` must be the same list (in the same
 * order) passed to convex/morphology/generate.ts's applyAffixesToRoot to
 * produce `assembled`, so segment sources can be resolved back to their
 * originating affix.
 */
export function composeWordGlyphSequence(
  assembled: AssembledWord,
  affixesUsed: MorphologyAffixData[],
  phonology: PhonologyData,
  mapping: SoundToSymbolMapping,
  aesthetic: Aesthetic,
): ComposedWord {
  const resolved = resolvePhonemes(assembled.phonemeIds, phonology);
  if (!resolved) return { steps: [], nonSegmentalTreatment: null };

  const groups = groupIntoGraphemes(resolved, mapping);
  const affixesById = new Map(affixesUsed.map((a) => [a.id, a] as const));

  const steps: GlyphSequenceStep[] = groups.map((group, i) => {
    let junctionBefore: BoundaryTreatment | null = null;
    if (i > 0) {
      const segmentAtStart = assembled.segments.find((s) => s.start === group.start && s.source !== "root");
      const affix = segmentAtStart ? affixesById.get(segmentAtStart.source) : undefined;
      junctionBefore = affix ? resolveBoundaryTreatment(affix.strategy, aesthetic) : "adjacency";
    }
    return { glyphId: group.glyphId, diacriticGlyphId: group.diacriticGlyphId, extraGlyphIds: group.extraGlyphIds, junctionBefore };
  });

  const nonSegmental = affixesUsed.find((a) => a.strategy === "ablaut" || a.strategy === "templatic");
  const nonSegmentalTreatment = nonSegmental ? resolveBoundaryTreatment(nonSegmental.strategy, aesthetic) : null;

  return { steps, nonSegmentalTreatment };
}
