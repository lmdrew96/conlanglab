import { diffAtomic, diffKeyedArray, type DiffOp } from "../lib/history";
import type { OrthographyStageData } from "./types";

export function diffOrthography(prev: OrthographyStageData, next: OrthographyStageData): DiffOp[] {
  return [
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.scriptStyle, next.scriptStyle, "scriptStyle"),
    ...diffKeyedArray(prev.glyphs, next.glyphs, "glyphs"),
    ...diffAtomic(prev.mapping, next.mapping, "mapping"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
  ];
}
