// Section 12: four purely-aesthetic themes, no functional/typological tie-in.
// Token values are derived from the raw palette (Section 12.1) but adjusted
// where the literal swatches fail WCAG AA — Section 12.3 explicitly permits
// this ("using the palette hues as a starting aesthetic target rather than
// the literal exact hex-to-hex pairing wherever that pairing would be
// illegible"). Adjustments were verified against real contrast ratios
// (relative luminance per WCAG 2.x), not eyeballed:
//
// - Vernacular: Teak (#af8c62) only hits 3.13:1 on Matterhorn surfaces, below
//   the 4.5:1 body-text threshold — `text` is a lightened Teak tint instead.
// - Glossolalia: Lime Cream and Light Gold are both light and fail contrast
//   against each other entirely (flagged in Section 12.3) — neither is used
//   as a background here, both stay in the light-text-on-dark-bg role only.
// - Isogloss / Prosody: the flagged mid-tone pairs (Burnt Sienna/Sandy Brown,
//   Dusk Blue/Vintage Grape) are never placed as text-on-background together.

export type ThemeName = "vernacular" | "isogloss" | "glossolalia" | "prosody";

export interface ThemeTokens {
  label: string;
  mood: string;
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentText: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  vernacular: {
    label: "Vernacular",
    mood: "Warm, earthy, autumnal — cozy and grounded",
    bg: "#252226",
    surface: "#363437",
    surfaceHover: "#444144",
    border: "#545255",
    text: "#b79872",
    textMuted: "#7c8482",
    accent: "#af8c62",
    accentHover: "#c4a17a",
    accentText: "#1a1a1a",
  },
  isogloss: {
    label: "Isogloss",
    mood: "Sunset drama — warm oranges against cool dark blues",
    bg: "#272233",
    surface: "#383443",
    surfaceHover: "#454150",
    border: "#56525f",
    text: "#f4a971",
    textMuted: "#dd7057",
    accent: "#dd7057",
    accentHover: "#e8896f",
    accentText: "#1a1a1a",
  },
  glossolalia: {
    label: "Glossolalia",
    mood: "Nature meets nightfall — yellow-greens against violet-black",
    bg: "#210124",
    surface: "#331536",
    surfaceHover: "#402543",
    border: "#523854",
    text: "#f4fdaf",
    textMuted: "#efdd8d",
    accent: "#65743a",
    accentHover: "#78894a",
    accentText: "#ffffff",
  },
  prosody: {
    label: "Prosody",
    mood: "Elegant, romantic — cool pastels against deep wine",
    bg: "#420404",
    surface: "#511818",
    surfaceHover: "#5c2727",
    border: "#6b3b3b",
    text: "#afcefd",
    textMuted: "#9f8def",
    accent: "#9f8def",
    accentHover: "#b09fef",
    accentText: "#1a1a1a",
  },
};

export const DEFAULT_THEME: ThemeName = "vernacular";

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && value in THEMES;
}
