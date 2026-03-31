import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import './head2head.css';

const Head2HeadClient = dynamic(() => import('./Head2HeadClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Head 2 Head — Next.js SSR wrapper
   Route: /:league/head2head
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://leaguescope.gg';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `Comparador | ${leagueUpper}`;
  const description = `Compara equipos y jugadores de ${leagueUpper} cara a cara con estadísticas detalladas.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/head2head`,
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
      canonical: `${BASE_URL}/${league}/head2head`,
    },
  };
}

export default async function Head2HeadPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent, glow } = getLeagueColors(league);

  return (
    <Head2HeadClient
      league={league}
      accent={accent}
      glow={glow}
    />
  );
}
