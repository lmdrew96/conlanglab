import { diffAtomic, type DiffOp } from "../lib/history";
import type { SyntaxStageData } from "./types";

export function diffSyntax(prev: SyntaxStageData, next: SyntaxStageData): DiffOp[] {
  return [
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.phraseStructure, next.phraseStructure, "phraseStructure"),
    ...diffAtomic(prev.exampleConcepts, next.exampleConcepts, "exampleConcepts"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
  ];
}
