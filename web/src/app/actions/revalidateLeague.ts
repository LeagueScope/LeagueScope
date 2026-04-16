'use server';

import { revalidatePath } from 'next/cache';

/**
 * Server Action used by LeaguePagePoller to force a fresh render of all
 * pages under /[league]/* when a live-match state change is detected.
 *
 * We use revalidatePath with the 'layout' type so every segment below
 * the dynamic [league] segment is invalidated (overview, standings,
 * record, etc.) regardless of which sub-route the user is currently on.
 *
 * Combined with the SSR fetches (revalidate: 60-120s), this ensures the
 * next router.refresh() pulls fresh data from the backend.
 */
export async function revalidateLeagueLive(league: string) {
  const safe = (league || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return;
  revalidatePath(`/${safe}`, 'layout');
}
