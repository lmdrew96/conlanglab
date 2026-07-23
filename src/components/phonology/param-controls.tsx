"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import type { InventorySize, PhonologyParams } from "@/lib/phonology/engine";

const SIZE_OPTIONS: InventorySize[] = ["small", "medium", "large"];

function SizeSelector({
  label,
  info,
  value,
  onChange,
}: {
  label: string;
  info: string;
  value: InventorySize;
  onChange: (next: InventorySize) => void;
}) {
  return (
    <div>
      <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
        {label}
        <InfoTooltip text={info} />
      </span>
      <div className="flex gap-1">
        {SIZE_OPTIONS.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => onChange(size)}
            className={`flex-1 rounded-md px-2 py-1 text-sm capitalize ${
              value === size ? "bg-accent text-accent-text" : "bg-surface text-text-muted hover:bg-surface-hover"
            }`}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderControl({
  label,
  info,
  value,
  onChange,
}: {
  label: string;
  info: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          {label}
          <InfoTooltip text={info} />
        </span>
        <span className="text-xs text-text-muted">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[color:var(--color-accent)]"
      />
    </div>
  );
}

function ToggleControl({
  label,
  info,
  checked,
  onChange,
}: {
  label: string;
  info: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="flex items-center gap-1.5 text-sm text-text">
        {label}
        <InfoTooltip text={info} />
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-accent)]"
      />
    </label>
  );
}

export function ParamControls({
  params,
  onChange,
}: {
  params: PhonologyParams;
  onChange: (next: PhonologyParams) => void;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-muted">Parameters</h3>

      <SizeSelector
        label="Consonant inventory size"
        info="How many consonants the language has. Small (~14), Medium (~20), or Large (~27), filled core-outward from cross-linguistically common sounds first."
        value={params.consonantInventorySize}
        onChange={(consonantInventorySize) => onChange({ ...params, consonantInventorySize })}
      />
      <SizeSelector
        label="Vowel inventory size"
        info="How many distinct vowel qualities the language has. Small (~5), Medium (~7), or Large (~10)."
        value={params.vowelInventorySize}
        onChange={(vowelInventorySize) => onChange({ ...params, vowelInventorySize })}
      />

      <SliderControl
        label="Typological strictness"
        info="Higher = adheres closely to attested cross-linguistic universals. Lower = allows rarer, more speculative sound combinations."
        value={params.typologicalStrictness}
        onChange={(typologicalStrictness) => onChange({ ...params, typologicalStrictness })}
      />
      <SliderControl
        label="Cluster complexity"
        info="How many consonants can stack together at the start or end of a syllable. Higher = larger onset/coda clusters."
        value={params.clusterComplexity}
        onChange={(clusterComplexity) => onChange({ ...params, clusterComplexity })}
      />
      <SliderControl
        label="Sonority violation rate"
        info="By default, clusters rise in sonority toward the vowel and fall away from it (the Sonority Sequencing Principle) for an elegant sound. This deliberately allows harsh, sonority-violating clusters at the given rate instead — 0 means none."
        value={params.sonorityViolationRate}
        onChange={(sonorityViolationRate) => onChange({ ...params, sonorityViolationRate })}
      />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text">Marked features</span>
        <ToggleControl
          label="Ejectives"
          info="Consonants pronounced with a glottal closure for a sharp, popping sound — common in Caucasian and many Native American languages."
          checked={params.markedFeatures.ejectives}
          onChange={(v) => onChange({ ...params, markedFeatures: { ...params.markedFeatures, ejectives: v } })}
        />
        <ToggleControl
          label="Clicks"
          info="Consonants made by creating suction in the mouth rather than pushing air out — found in languages like Zulu and Xhosa."
          checked={params.markedFeatures.clicks}
          onChange={(v) => onChange({ ...params, markedFeatures: { ...params.markedFeatures, clicks: v } })}
        />
        <ToggleControl
          label="Implosives"
          info="Voiced stops pronounced with an inward airflow, giving them a soft, imploded quality."
          checked={params.markedFeatures.implosives}
          onChange={(v) => onChange({ ...params, markedFeatures: { ...params.markedFeatures, implosives: v } })}
        />
        <ToggleControl
          label="Front rounded vowels"
          info="Vowels like /y/ or /ø/ — tongue position of 'ee' with the lip-rounding of 'oo', as in French or German."
          checked={params.markedFeatures.frontRoundedVowels}
          onChange={(v) =>
            onChange({ ...params, markedFeatures: { ...params.markedFeatures, frontRoundedVowels: v } })
          }
        />
      </div>
    </div>
  );
}
