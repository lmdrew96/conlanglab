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
];
