import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import OverviewClient from './OverviewClient';
import type { OverviewData } from './OverviewClient';
import LeaguePagePoller from '@/app/components/LeaguePagePoller';

/* ═══════════════════════════════════════════════════════════════════════════
   Overview — Next.js SSR wrapper
   Route: /:league/overview
   Fetches overview data on server, passes to interactive client
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

// ── SEO Metadata ──────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Overview`;
  const description = `Estadísticas generales de ${leagueUpper}: campeones más jugados, rendimiento por lado, bans, jugadores destacados y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/overview`,
      siteName: 'LeagueScope',
      type: 'website',
      locale: 'es_ES',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
    alternates: {
      canonical: `${BASE_URL}/${league}/overview`,
    },
  };
}

export type { OverviewData };


// ── Data fetching ─────────────────────────────────────────────────────────
async function getOverviewData(league: string): Promise<OverviewData | null> {
  try {
    return await api<OverviewData>(`/pg/overview?league=${league}&full=1`, { revalidate: 120 });
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function OverviewPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);
  const data = await getOverviewData(league);

  return (
    <>
      <OverviewClient league={league} accent={accent} initialData={data} />
      <LeaguePagePoller league={league} />
    </>
  );
}
