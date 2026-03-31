'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  /** Duration of the animation in ms (default: 600) */
  duration?: number;
  /** Number of decimal places (default: auto-detect from value) */
  decimals?: number;
  /** Optional suffix like '%' */
  suffix?: string;
  /** Optional prefix like '+' for positive diffs */
  prefix?: string;
  /** Format function override — receives the current animated value */
  format?: (v: number) => string;
}

/**
 * Smoothly animates between number values using requestAnimationFrame.
 * The counter eases in/out for a natural feel.
 */
export default function AnimatedNumber({
  value,
  duration = 500,
  decimals,
  suffix = '',
  prefix = '',
  format,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;

    // Skip animation if same value or first mount
    if (from === to) {
      setDisplay(to);
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-in-out cubic
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const dec =
    decimals !== undefined
      ? decimals
      : Number.isInteger(value)
        ? 0
        : value >= 100
          ? 0
          : value >= 10
            ? 1
            : 2;

  const text = format
    ? format(display)
    : `${prefix}${display.toFixed(dec)}${suffix}`;

  return <>{text}</>;
}
