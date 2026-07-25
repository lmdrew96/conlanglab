"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PhonologyData, StressPattern } from "@/lib/phonology/engine";
import { formatStressPattern } from "@/lib/phonology/format";
import { InfoTooltip } from "@/components/info-tooltip";
import { LockIcon } from "@/components/icons";

const STRESS_PATTERNS: StressPattern[] = ["initial", "penultimate", "final", "weightSensitive", "none"];

function LockButton({ locked, disabled, onClick }: { locked: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      {locked ? (
        <span className="inline-flex items-center gap-1">
          <LockIcon className="h-3 w-3" /> Locked
        </span>
      ) : (
        "Lock"
      )}
    </button>
  );
}

export function SuprasegmentalControls({
  languageId,
  data,
  stageLocked,
}: {
  languageId: Id<"languages">;
  data: PhonologyData;
  stageLocked: boolean;
}) {
  const setStressPattern = useMutation(api.phonology.mutations.setStressPattern);
  const setTone = useMutation(api.phonology.mutations.setTone);
  const toggleFieldLock = useMutation(api.phonology.mutations.toggleFieldLock);

  const disabled = stageLocked || data.stress.locked;
  const toneDisabled = stageLocked || data.tone.locked;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-muted">
            Stress
            <InfoTooltip text="Which syllable gets emphasized when the word is spoken — a fixed position (first, last, second-to-last) or weight-sensitive, where syllables with a coda consonant attract stress." />
          </h3>
          <LockButton
            locked={data.stress.locked}
            disabled={stageLocked}
            onClick={() => toggleFieldLock({ languageId, field: "stress", locked: !data.stress.locked })}
          />
        </div>
        <select
          value={data.stress.pattern}
          disabled={disabled}
          onChange={(e) => setStressPattern({ languageId, pattern: e.target.value as StressPattern })}
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text disabled:opacity-60"
        >
          {STRESS_PATTERNS.map((pattern) => (
            <option key={pattern} value={pattern}>
              {formatStressPattern(pattern)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-muted">
            Tone
            <InfoTooltip text="An optional pitch contrast that changes word meaning, like Mandarin's four tones. Levels are the number of contrastive pitches; contours add rising/falling pitch shapes on top of level tones." />
          </h3>
          <LockButton
            locked={data.tone.locked}
            disabled={stageLocked}
            onClick={() => toggleFieldLock({ languageId, field: "tone", locked: !data.tone.locked })}
          />
        </div>
        <label className="mb-2 flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={data.tone.enabled}
            disabled={toneDisabled}
            onChange={(e) =>
              setTone({
                languageId,
                enabled: e.target.checked,
                levels: data.tone.levels,
                contours: data.tone.contours,
              })
            }
            className="h-4 w-4 accent-[color:var(--color-accent)]"
          />
          Tonal system enabled
        </label>
        {data.tone.enabled && (
          <div className="flex flex-col gap-2 pl-6">
            <label className="flex items-center justify-between text-sm text-text-muted">
              Contrastive levels
              <input
                type="number"
                min={2}
                max={5}
                value={data.tone.levels}
                disabled={toneDisabled}
                onChange={(e) =>
                  setTone({
                    languageId,
                    enabled: true,
                    levels: Number(e.target.value),
                    contours: data.tone.contours,
                  })
                }
                className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-right text-text disabled:opacity-60"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={data.tone.contours}
                disabled={toneDisabled}
                onChange={(e) =>
                  setTone({ languageId, enabled: true, levels: data.tone.levels, contours: e.target.checked })
                }
                className="h-4 w-4 accent-[color:var(--color-accent)]"
              />
              Contour tones (rising/falling)
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
