"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { Dial } from "@/components/dial";
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
          included. These dials bias which culture-flavor domains fill the remaining root budget.
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
          <Dial
            value={params.domainWeights[domain]}
            onChange={(next) => onChange({ ...params, domainWeights: { ...params.domainWeights, [domain]: next } })}
            label={formatDomain(domain)}
          />
        </div>
      ))}
    </div>
  );
}
