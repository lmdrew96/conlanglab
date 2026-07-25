// Client/server boundary, made explicit in one place — same rationale as
// src/lib/syntax/engine.ts. Only pure, zero-Convex-import modules from
// convex/orthography/* are re-exported here; UI components import from
// here, not from convex/orthography/* directly.

export {
  buildGlyphForSyllable,
  buildScriptStyle,
  composeWordGlyphSequence,
  extractAttestedSyllables,
  resolveBoundaryTreatment,
  sampleGlyphs,
  syllableGlyphId,
} from "../../../convex/orthography/generate";
export { glyphToSvgPath, scriptStyleViewBox, strokeToSvgPath } from "../../../convex/orthography/render";
export { AESTHETICS, DEFAULT_ORTHOGRAPHY_PARAMS, SCRIPT_CATEGORIES } from "../../../convex/orthography/types";

export type { AttestedSyllable, ComposedWord, GlyphSequenceStep } from "../../../convex/orthography/generate";
export type {
  Aesthetic,
  BoundaryTreatment,
  Glyph,
  GlyphKind,
  OrthographyParams,
  OrthographyStageData,
  Point,
  ScriptCategory,
  ScriptStyle,
  SoundToSymbolMapping,
  Stroke,
} from "../../../convex/orthography/types";
