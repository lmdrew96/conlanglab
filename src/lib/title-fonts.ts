// One localFont call per file in the repo's /fonts directory (ChaosPatch:
// "title font rotary" — the header title cycles through all of them).
import localFont from "next/font/local";

const blueberryHills = localFont({ src: "../../fonts/BlueberryHillsProxee.ttf" });
const brailleDisplay = localFont({ src: "../../fonts/BrailleDisplay.ttf" });
const camarineDisco = localFont({ src: "../../fonts/CamarineDisco.otf" });
const csSlackerStitched = localFont({ src: "../../fonts/CsSlackerStitched.otf" });
const englishToManakahthey = localFont({ src: "../../fonts/EnglishToManakahthey.ttf" });
const fsHakumo = localFont({ src: "../../fonts/FsHakumo.ttf" });
export const inLivingColor = localFont({ src: "../../fonts/InLivingColorRegular.ttf" });
const karen = localFont({ src: "../../fonts/Karen.ttf" });
const lowballNeue = localFont({ src: "../../fonts/LowballNeueExtraLight.ttf" });
const superMarioDs = localFont({ src: "../../fonts/SuperMarioDs.ttf" });
const yoshinese = localFont({ src: "../../fonts/Yoshinese.ttf" });
const aurekBeshHand = localFont({ src: "../../fonts/new-fonts/AurekBeshHand-pROK.ttf" });
const britannian = localFont({ src: "../../fonts/new-fonts/Britannian-J4oB.ttf" });
// Etruscan-K76A.ttf and Korohanza-nRlM.ttf are excluded: both ship only a
// legacy Mac Roman (platform 1) cmap with a non-standard glyph order, no
// Unicode cmap at all, so every character in the rotary title falls back to
// the next font in the stack instead of rendering in these fonts.
const luciusCipher = localFont({ src: "../../fonts/new-fonts/LuciusCipher-3zYvy.ttf" });
const oneVerse = localFont({ src: "../../fonts/new-fonts/OneVerseRegular-PKM4x.ttf" });
const ptgulShikieika = localFont({ src: "../../fonts/new-fonts/PtgulShikieika-d9Anl.ttf" });
const reanaarian = localFont({ src: "../../fonts/new-fonts/Reanaarian-j4mG.ttf" });
const sithAf = localFont({ src: "../../fonts/new-fonts/SithAf-mLlyv.otf" });
const tau = localFont({ src: "../../fonts/new-fonts/Tau-mmP2.ttf" });
const tuigan = localFont({ src: "../../fonts/new-fonts/Tuigan-KppX.ttf" });
const xidusLeadeaNative = localFont({ src: "../../fonts/new-fonts/XidusLeadeaNative-vWAM.ttf" });
const yugurian = localFont({ src: "../../fonts/new-fonts/Yugurian-KYDZ.ttf" });

export const TITLE_FONTS = [
  blueberryHills,
  brailleDisplay,
  camarineDisco,
  csSlackerStitched,
  englishToManakahthey,
  fsHakumo,
  inLivingColor,
  karen,
  lowballNeue,
  superMarioDs,
  yoshinese,
  aurekBeshHand,
  britannian,
  luciusCipher,
  oneVerse,
  ptgulShikieika,
  reanaarian,
  sithAf,
  tau,
  tuigan,
  xidusLeadeaNative,
  yugurian,
];
