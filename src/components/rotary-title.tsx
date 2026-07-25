"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TITLE_FONTS } from "@/lib/title-fonts";

const CYCLE_INTERVAL_MS = 3000;

/** Header title that cycles through every font in /fonts, flipping upward like a split-flap/rotary clock on each change. */
export function RotaryTitle({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % TITLE_FONTS.length);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-block [perspective:400px]">
      <span key={index} className={`${TITLE_FONTS[index].className} rotary-flip inline-block`}>
        {children}
      </span>
    </span>
  );
}
