'use server';

import { revalidatePath } from 'next/cache';

/**
 * Server Action used by HomeLivePoller to force a fresh render of the Home
 * page when a live-match state change is detected.
 *
 * We use revalidatePath('/') instead of revalidateTag because on AWS Amplify
 * WEB_COMPUTE the Next.js Data Cache is per-Lambda instance, so tag-based
 * invalidation does not propagate across instances reliably.
 *
 * Combined with the server component fetching `/pg/home` with revalidate=0
 * (no Data Cache), this guarantees router.refresh() returns fresh data.
 */
export async function revalidateHomeLive() {
  revalidatePath('/');
}
