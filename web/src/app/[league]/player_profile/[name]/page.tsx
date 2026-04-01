import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { PlayerJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import './player-profile.css';

const PlayerProfileClient = dynamic(() => import('./PlayerProfileClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   PlayerProfile — Next.js SSR shell
   Route: /:league/player_profile/:name?team=ABBR
   Data fetching stays client-side due to chained/fallback logic
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}): Promise<Metadata> {
  const { league, name } = await params;
  const leagueUpper = league.toUpperCase();
  const decodedName = decodeURIComponent(name);
  const title = `${decodedName} — ${leagueUpper} Player Profile`;
  const description = `Perfil de ${decodedName} en ${leagueUpper}: KDA, estadísticas por fase, champion pool, historial de partidas.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/player_profile/${encodeURIComponent(decodedName)}`,
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
      canonical: `${BASE_URL}/${league}/player_profile/${encodeURIComponent(decodedName)}`,
    },
  };
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}) {
  const { league, name } = await params;
  const { accent } = getLeagueColors(league);

  const decodedName = decodeURIComponent(name);
  const leagueUpper = league.toUpperCase();

  return (
    <>
      <PlayerJsonLd
        name={decodedName}
        league={league}
        url={`/${league}/player_profile/${encodeURIComponent(decodedName)}`}
      />
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: leagueUpper, href: `/${league}/overview` },
          { name: decodedName, href: `/${league}/player_profile/${encodeURIComponent(decodedName)}` },
        ]}
      />
      <PlayerProfileClient
        league={league}
        name={decodedName}
        accent={accent}
      />
    </>
  );
}
