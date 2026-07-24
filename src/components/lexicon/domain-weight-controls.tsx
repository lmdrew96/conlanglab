"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { FLEXIBLE_DOMAINS } from "@/lib/lexicon/engine";
import { domainInfo, formatDomain } from "@/lib/lexicon/format";
import type { LexiconParams } from "@/lib/lexicon/engine";

export function DomainWeightControls({
  params,
  onChange,
}: {
  params: LexiconParams;
  onChange: (next: LexiconParams) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-text-muted">Domain weighting</h3>
        <p className="mt-1 text-xs text-text-muted">
          The core list (Swadesh-extended vocabulary, emotions, social roles, technology, objects) is always
          included. These sliders bias which culture-flavor domains fill the remaining root budget.
        </p>
      </div>
      {FLEXIBLE_DOMAINS.map((domain) => (
        <div key={domain}>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-text">
              {formatDomain(domain)}
              <InfoTooltip text={domainInfo(domain)} />
            </span>
            <span className="text-xs text-text-muted">{Math.round(params.domainWeights[domain] * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.domainWeights[domain]}
            onChange={(e) =>
              onChange({ ...params, domainWeights: { ...params.domainWeights, [domain]: Number(e.target.value) } })
            }
            className="w-full accent-[color:var(--color-accent)]"
          />
        </div>
      ))}
    </div>
  );
}
