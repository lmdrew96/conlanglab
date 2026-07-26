"use client";

// Rotary knob control (ChaosPatch: "swap sliders for dials" — a scientific
// device dashboard feel). 270° sweep with a gap at the bottom, same
// convention as a physical audio/instrument knob: pointer rests bottom-left
// at min, straight up at the midpoint, bottom-right at max. Dragging
// vertically (not clicking a track position) is the standard interaction
// for small knobs — precise click-to-angle targeting is fiddly at this size.

import { useCallback, useRef, useState } from "react";

const START_DEG = -135;
const SWEEP_DEG = 270;
const DRAG_SENSITIVITY_PX = 150;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function snapToStep(v: number, min: number, step: number): number {
  return Math.round((v - min) / step) * step + min;
}

export function Dial({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  size = 56,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: number;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; value: number } | null>(null);

  const setFromDeltaY = useCallback(
    (deltaY: number) => {
      if (!dragStart.current) return;
      const range = max - min;
      const next = clamp(dragStart.current.value + (deltaY / DRAG_SENSITIVITY_PX) * range, min, max);
      onChange(snapToStep(next, min, step));
    },
    [max, min, step, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, value };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setFromDeltaY(dragStart.current.y - e.clientY);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStart.current = null;
    setDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp(snapToStep(value + step, min, step), min, max));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp(snapToStep(value - step, min, step), min, max));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  };

  const fraction = (value - min) / (max - min);
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = Math.max(2, size * 0.09);
  const r = size / 2 - strokeWidth / 2 - 1;
  const circumference = 2 * Math.PI * r;
  const trackDash = circumference * (SWEEP_DEG / 360);
  const valueDash = trackDash * fraction;
  const pointerAngle = START_DEG + fraction * SWEEP_DEG;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={`touch-none select-none rounded-full focus:outline-none focus:ring-2 focus:ring-accent ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${trackDash} ${circumference}`}
          transform={`rotate(135, ${cx}, ${cy})`}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${valueDash} ${circumference}`}
          transform={`rotate(135, ${cx}, ${cy})`}
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={cy - r + strokeWidth}
          stroke="var(--color-text)"
          strokeWidth={Math.max(1.5, strokeWidth * 0.5)}
          strokeLinecap="round"
          transform={`rotate(${pointerAngle}, ${cx}, ${cy})`}
        />
      </svg>
    </div>
  );
}
