"use client";

import { useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GlyphSvg } from "@/components/orthography/glyph-svg";
import { LockIcon, SpeakerIcon } from "@/components/icons";
import { playPhoneme } from "@/lib/phonology/audio";
import { playRoot } from "@/lib/lexicon/audio";
import type { Glyph, OrthographyStageData } from "@/lib/orthography/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

interface GlyphSound {
  /** IPA display label — a single phoneme's `ipa`, a syllable's concatenated onset+nucleus, or (logographic) the root's full `phonologicalForm`. */
  label: string;
  play: () => void;
}

/**
 * Resolves a glyph back to the sound(s) it represents, keyed the same way
 * generate.ts's `buildMapping`/`groupIntoGraphemes` key glyph ids — reuses
 * the exact same audio players every other engine page uses (phonology's
 * playPhoneme for a single phoneme, lexicon's playRoot for a phoneme
 * sequence) rather than a parallel synth path. Returns null when a
 * referenced phoneme/root can no longer be resolved (e.g. an upstream edit
 * this glyph set hasn't regenerated against yet) — same "disable playback
 * rather than guess" contract as playRoot's own null return.
 */
function resolveGlyphSound(
  glyph: Glyph,
  mapping: OrthographyStageData["mapping"],
  phonology: PhonologyData,
  lexiconItemsById: Map<string, LexiconItemData>,
): GlyphSound | null {
  const findConsonant = (id: string) => phonology.consonants.find((c) => c.id === id);
  const findVowel = (id: string) => phonology.vowels.find((v) => v.id === id);

  switch (mapping.kind) {
    case "alphabetic":
    case "abjad": {
      const consonant = findConsonant(glyph.id);
      if (consonant) return { label: consonant.ipa, play: () => playPhoneme(consonant) };
      const vowel = findVowel(glyph.id);
      return vowel ? { label: vowel.ipa, play: () => playPhoneme(vowel) } : null;
    }
    case "abugida": {
      if (glyph.kind === "vowelDiacritic") {
        const vowel = findVowel(glyph.id.replace(/^diacritic:/, ""));
        return vowel ? { label: vowel.ipa, play: () => playPhoneme(vowel) } : null;
      }
      const consonant = findConsonant(glyph.id);
      return consonant ? { label: consonant.ipa, play: () => playPhoneme(consonant) } : null;
    }
    case "syllabic": {
      const [consonantPart, vowelId] = glyph.id.split("+");
      const vowel = vowelId ? findVowel(vowelId) : undefined;
      if (!vowel) return null;
      const consonant = consonantPart !== "_" ? findConsonant(consonantPart) : undefined;
      const phonemeIds = consonant ? [consonant.id, vowel.id] : [vowel.id];
      return { label: `${consonant?.ipa ?? ""}${vowel.ipa}`, play: () => playRoot(phonemeIds, phonology) };
    }
    case "logographic": {
      const item = lexiconItemsById.get(glyph.id);
      return item
        ? { label: item.phonologicalForm, play: () => playRoot(item.phonemeIds, phonology, item.stressedPhonemeIndex) }
        : null;
    }
  }
}

function GlyphChip({
  glyph,
  style,
  sound,
  disabled,
  onToggleLock,
}: {
  glyph: Glyph;
  style: OrthographyStageData["scriptStyle"];
  sound: GlyphSound | null;
  disabled: boolean;
  onToggleLock: () => void;
}) {
  return (
    <span
      className={`flex flex-col items-center gap-0.5 rounded-md border text-sm transition-colors ${
        glyph.locked ? "border-accent bg-accent/20 text-text" : "border-border bg-bg text-text-muted hover:bg-surface-hover"
      }`}
    >
      <span className="p-1.5">
        <GlyphSvg glyph={glyph} style={style} className="h-9 w-9" />
      </span>
      <span className="flex items-center gap-1 pb-1 text-[10px]">
        <button
          type="button"
          onClick={sound?.play}
          disabled={!sound}
          title={sound ? `Play /${sound.label}/` : "Regenerate to hear pronunciation"}
          className="hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <SpeakerIcon className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={onToggleLock}
          disabled={disabled}
          title={glyph.kind}
          className="flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="font-mono">{sound?.label ?? glyph.id}</span>
          {glyph.locked && <LockIcon className="h-2.5 w-2.5" />}
        </button>
      </span>
    </span>
  );
}

export function GlyphSetPanel({
  languageId,
  data,
  phonology,
  lexiconItems,
  stageLocked,
}: {
  languageId: Id<"languages">;
  data: OrthographyStageData;
  phonology: PhonologyData;
  lexiconItems: LexiconItemData[];
  stageLocked: boolean;
}) {
  const toggleGlyphLock = useMutation(api.orthography.mutations.toggleGlyphLock);
  const lexiconItemsById = useMemo(() => new Map(lexiconItems.map((i) => [i.id, i])), [lexiconItems]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-semibold text-text-muted">Glyphs ({data.glyphs.length})</h3>
      <div className="flex flex-wrap gap-2">
        {data.glyphs.map((g) => (
          <GlyphChip
            key={g.id}
            glyph={g}
            style={data.scriptStyle}
            sound={resolveGlyphSound(g, data.mapping, phonology, lexiconItemsById)}
            disabled={stageLocked}
            onToggleLock={() => toggleGlyphLock({ languageId, glyphId: g.id, locked: !g.locked })}
          />
        ))}
      </div>
    </div>
  );
}
