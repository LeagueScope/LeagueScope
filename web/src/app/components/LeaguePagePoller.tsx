'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { revalidateLeagueLive } from '../actions/revalidateLeague';

/* ═══════════════════════════════════════════════════════════════════════════
   LeaguePagePoller — Per-league live-state auto-refresh

   Analog of HomeLivePoller, but scoped to a single league so pages like
   /[league]/record, /[league]/standings, /[league]/overview stay fresh
   while a match of that league is live or ends — without forcing a page
   reload.

   Polls the lightweight /pg/live-status?league=XXX endpoint every
   POLL_INTERVAL ms. The first response only seeds the fingerprint (no
   refresh) to avoid a spurious re-render just after the SSR render.
   Subsequent changes trigger a revalidatePath + router.refresh().

   The effect also re-checks when the tab regains focus (catches matches
   that started or finished while the user was away).
   ═══════════════════════════════════════════════════════════════════════════ */

const POLL_INTERVAL = 30_000; // 30 seconds
const API_URL = '/api/v1/pg/live-status';

interface LiveStatus {
  liveCount: number;
  fingerprint: string;
}

export default function LeaguePagePoller({ league }: { league: string }) {
  const router = useRouter();
  const leagueUpper = (league || '').toUpperCase();
  const fingerprintRef = useRef<string | null>(null); // null = not seeded yet

  const checkLiveStatus = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch(
        `${API_URL}?league=${encodeURIComponent(leagueUpper)}`,
        { signal, cache: 'no-store' },
      );
      if (!res.ok) return;
      const data: LiveStatus = await res.json();

      // First response → just seed, don't refresh
      if (fingerprintRef.current === null) {
        fingerprintRef.current = data.fingerprint;
        return;
      }

      if (data.fingerprint !== fingerprintRef.current) {
        fingerprintRef.current = data.fingerprint;
        // 1. Bust the Next.js Data Cache for /[league]/* (server-side)
        // 2. Re-render Server Components with fresh data
        await revalidateLeagueLive(leagueUpper);
        router.refresh();
      }
    } catch {
      // Silently ignore — AbortError on unmount or network hiccup
    }
  }, [leagueUpper, router]);

  useEffect(() => {
    if (!leagueUpper) return;

    const controller = new AbortController();

    // Fire an immediate seed check on mount
    checkLiveStatus(controller.signal);

    const interval = setInterval(() => {
      checkLiveStatus(controller.signal);
    }, POLL_INTERVAL);

    // Re-check when the tab regains focus — if the user was away for a while,
    // catch up instantly instead of waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkLiveStatus(controller.signal);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      controller.abort();
    };
  }, [leagueUpper, checkLiveStatus]);

  return null; // renders nothing
}
