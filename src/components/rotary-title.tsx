"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TITLE_FONTS } from "@/lib/title-fonts";

const CYCLE_INTERVAL_MS = 3000;

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Header title that cycles through every font in /fonts, flipping upward
 * like a split-flap/rotary clock on each change. TITLE_FONTS lists Latin
 * fonts before constructed-script fonts, so cycling it in place order spent
 * the first half of every loop on Latin lettering and the second half on
 * constructed scripts. Shuffled once on mount (client-only, after the
 * SSR-matching first paint) so the two interleave instead.
 */
export function RotaryTitle({ children }: { children: ReactNode }) {
  const [fonts, setFonts] = useState(TITLE_FONTS);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setFonts(shuffle(TITLE_FONTS));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % fonts.length);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fonts]);

  return (
    <span className="inline-block [perspective:400px]">
      <span key={index} className={`${fonts[index].className} rotary-flip inline-block`}>
        {children}
      </span>
    </span>
  );
}
