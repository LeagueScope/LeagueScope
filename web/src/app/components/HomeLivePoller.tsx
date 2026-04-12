'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Invisible client component that triggers a server-side refresh
 * every 30 seconds when there are live matches on the home page.
 * Uses Next.js router.refresh() to re-render all Server Components
 * with fresh data without a full page reload.
 */
export default function HomeLivePoller({ hasLive }: { hasLive: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!hasLive) return;

    const interval = setInterval(() => {
      router.refresh();
    }, 30_000);

    return () => clearInterval(interval);
  }, [hasLive, router]);

  return null; // renders nothing
}
