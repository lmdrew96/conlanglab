"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConsonantPhoneme, PhonologyData, VowelPhoneme } from "@/lib/phonology/engine";
import { formatManner, formatPlace } from "@/lib/phonology/format";
import { playPhoneme } from "@/lib/phonology/audio";

function PhonemeChip({
  phoneme,
  ipa,
  locked,
  tooltip,
  disabled,
  onToggleLock,
}: {
  phoneme: ConsonantPhoneme | VowelPhoneme;
  ipa: string;
  locked: boolean;
  tooltip: string;
  disabled: boolean;
  onToggleLock: () => void;
}) {
  return (
    <span
      className={`flex items-center gap-0.5 rounded-md border text-sm transition-colors ${
        locked
          ? "border-accent bg-accent/20 text-text"
          : "border-border bg-bg text-text-muted hover:bg-surface-hover"
      }`}
    >
      <button
        type="button"
        onClick={() => playPhoneme(phoneme)}
        title={`Play /${ipa}/`}
        className="rounded-l-md py-1 pl-2 pr-0.5 hover:text-accent"
      >
        <span aria-hidden>🔊</span>
      </button>
      <button
        type="button"
        onClick={onToggleLock}
        disabled={disabled}
        title={tooltip}
        className="flex items-center gap-1 rounded-r-md py-1 pl-0.5 pr-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="font-mono">{ipa}</span>
        {locked && <span aria-hidden>🔒</span>}
      </button>
    </span>
  );
}

export function InventoryGrid({
  languageId,
  data,
  stageLocked,
}: {
  languageId: Id<"languages">;
  data: PhonologyData;
  stageLocked: boolean;
}) {
  const togglePhonemeLock = useMutation(api.phonology.mutations.togglePhonemeLock);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-text-muted">Consonants ({data.consonants.length})</h3>
        <div className="flex flex-wrap gap-1.5">
          {data.consonants.map((c) => (
            <PhonemeChip
              key={c.id}
              phoneme={c}
              ipa={c.ipa}
              locked={c.locked}
              disabled={stageLocked}
              tooltip={`${formatPlace(c.features.place)} ${formatManner(c.features.manner)}, ${c.features.voiced ? "voiced" : "voiceless"} (${c.tier})`}
              onToggleLock={() =>
                togglePhonemeLock({ languageId, kind: "consonant", phonemeId: c.id, locked: !c.locked })
              }
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-text-muted">Vowels ({data.vowels.length})</h3>
        <div className="flex flex-wrap gap-1.5">
          {data.vowels.map((v) => (
            <PhonemeChip
              key={v.id}
              phoneme={v}
              ipa={v.ipa}
              locked={v.locked}
              disabled={stageLocked}
              tooltip={`${v.features.height} ${v.features.backness}, ${v.features.rounded ? "rounded" : "unrounded"} (${v.tier})`}
              onToggleLock={() => togglePhonemeLock({ languageId, kind: "vowel", phonemeId: v.id, locked: !v.locked })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
