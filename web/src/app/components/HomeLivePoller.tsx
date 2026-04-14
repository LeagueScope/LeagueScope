'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { revalidateHomeLive } from '../actions/revalidateHome';

/* ═══════════════════════════════════════════════════════════════════════════
   HomeLivePoller — Real-time match state detection

   Polls the lightweight /pg/live-status endpoint every POLL_INTERVAL ms.
   When the fingerprint changes (match started, ended, or score changed)
   it triggers router.refresh() to re-render all Server Components with
   fresh data — no full page reload needed.

   Always active so it detects matches starting even when none were live
   at initial page load.
   ═══════════════════════════════════════════════════════════════════════════ */

const POLL_INTERVAL = 15_000; // 15 seconds
const API_URL = '/api/v1/pg/live-status';

interface LiveStatus {
  liveCount: number;
  fingerprint: string;
}

export default function HomeLivePoller({
  initialFingerprint,
}: {
  initialFingerprint: string;
}) {
  const router = useRouter();
  const fingerprintRef = useRef(initialFingerprint);

  const checkLiveStatus = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch(API_URL, { signal, cache: 'no-store' });
      if (!res.ok) return;
      const data: LiveStatus = await res.json();

      if (data.fingerprint !== fingerprintRef.current) {
        fingerprintRef.current = data.fingerprint;
        // 1. Bust the Next.js Data Cache for /pg/home (server-side)
        // 2. Re-render Server Components with fresh data
        await revalidateHomeLive();
        router.refresh();
      }
    } catch {
      // Silently ignore — AbortError on unmount or network hiccup
    }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    // Fire an immediate check on mount (catches fingerprint drift between
    // the server render and the client hydration — e.g. tab returned from
    // background, stale cache).
    checkLiveStatus(controller.signal);

    const interval = setInterval(() => {
      checkLiveStatus(controller.signal);
    }, POLL_INTERVAL);

    // Also re-check when the tab regains focus — if the user was away for a
    // while, we want to catch up instantly instead of waiting for the next tick.
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
  }, [checkLiveStatus]);

  return null; // renders nothing
}
