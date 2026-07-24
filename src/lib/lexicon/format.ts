import type { FlexibleDomain, PartOfSpeech } from "./engine";

const DOMAIN_LABELS: Record<FlexibleDomain, string> = {
  nautical: "Nautical",
  agricultural: "Agricultural",
  martial: "Martial",
  mercantile: "Mercantile",
  pastoral: "Pastoral",
  craft: "Craft",
};

const DOMAIN_INFO: Record<FlexibleDomain, string> = {
  nautical: "Ships, tides, harbors — vocabulary for a seafaring people.",
  agricultural: "Fields, crops, harvests — vocabulary for a farming people.",
  martial: "Arms, armies, battle — vocabulary for a warlike people.",
  mercantile: "Trade, contracts, markets — vocabulary for a merchant people.",
  pastoral: "Herding, hunting, the trail — vocabulary for a nomadic or hunting people.",
  craft: "Forges, looms, workshops — vocabulary for an artisan people.",
};

export function formatDomain(domain: FlexibleDomain): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function domainInfo(domain: FlexibleDomain): string {
  return DOMAIN_INFO[domain] ?? "";
}

const POS_LABELS: Record<PartOfSpeech, string> = {
  noun: "n.",
  verb: "v.",
  adjective: "adj.",
  adverb: "adv.",
  pronoun: "pron.",
  numeral: "num.",
  function: "func.",
};

export function formatPartOfSpeech(pos: PartOfSpeech): string {
  return POS_LABELS[pos] ?? pos;
}
