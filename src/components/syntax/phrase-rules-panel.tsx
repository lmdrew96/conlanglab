import {
  formatAdjectiveOrder,
  formatAdpositionOrder,
  formatGenitiveOrder,
  formatPhraseRules,
  formatWordOrder,
} from "@/lib/syntax/format";
import type { PhraseStructureData } from "@/lib/syntax/engine";

/** Section 7.2's "basic phrase-structure rules" output, rendered as human-readable lines plus the underlying Greenberg-correlated order badges. */
export function PhraseRulesPanel({ phraseStructure }: { phraseStructure: PhraseStructureData }) {
  const rules = formatPhraseRules(phraseStructure);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-muted">Phrase structure rules</h3>
      <ul className="flex flex-col gap-1 text-sm text-text">
        {rules.map((rule) => (
          <li key={rule} className="font-mono">
            {rule}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        <span className="rounded bg-surface-hover px-2 py-1">{formatWordOrder(phraseStructure.wordOrder)}</span>
        <span className="rounded bg-surface-hover px-2 py-1">
          {formatAdpositionOrder(phraseStructure.adpositionOrder)}
        </span>
        <span className="rounded bg-surface-hover px-2 py-1">{formatGenitiveOrder(phraseStructure.genitiveOrder)}</span>
        <span className="rounded bg-surface-hover px-2 py-1">
          {formatAdjectiveOrder(phraseStructure.adjectiveOrder)}
        </span>
      </div>
    </div>
  );
}
