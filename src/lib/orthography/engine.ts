// Client/server boundary, made explicit in one place — same rationale as
// src/lib/syntax/engine.ts. Only pure, zero-Convex-import modules from
// convex/orthography/* are re-exported here; UI components import from
// here, not from convex/orthography/* directly.

export {
  buildGlyphForSyllable,
  buildScriptStyle,
  buildToneMarkStrokes,
  composeWordGlyphSequence,
  extractAttestedSyllables,
  resolveBoundaryTreatment,
  resolveGlyphById,
  sampleGlyphs,
  syllableGlyphId,
} from "../../../convex/orthography/generate";
export { glyphToSvgPath, scriptStyleViewBox, strokeToSvgPath } from "../../../convex/orthography/render";
export {
  AESTHETICS,
  ANCESTOR_SCRIPT_FAMILIES,
  DEFAULT_ORTHOGRAPHY_PARAMS,
  OVERFLOW_STRATEGIES,
  SCRIPT_CATEGORIES,
} from "../../../convex/orthography/types";

export type { AttestedSyllable, ComposedWord, GlyphSequenceStep } from "../../../convex/orthography/generate";
export type {
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
  SoundToSymbolMapping,
  Stroke,
} from "../../../convex/orthography/types";
