import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { BreadcrumbJsonLd, PlayerJsonLd } from '@/components/JsonLd';
import './player-history.css';

const PlayerHistoricalClient = dynamic(() => import('./PlayerHistoricalClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Player Historical — Next.js SSR wrapper
   Route: /:league/player_historical/:name
   Thin shell: passes league, name, accent/glow to client component
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://leaguescope.gg';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}): Promise<Metadata> {
  const { league, name } = await params;
  const leagueUpper = league.toUpperCase();
  const playerName = decodeURIComponent(name);
  const title = `${playerName} — Historial | ${leagueUpper}`;
  const description = `Historial completo de ${playerName} en ${leagueUpper}: palmarés, rendimiento por temporada, pool de campeones y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/player_historical/${encodeURIComponent(playerName)}`,
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
      canonical: `${BASE_URL}/${league}/player_historical/${encodeURIComponent(playerName)}`,
    },
  };
}

export default async function PlayerHistoricalPage({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}) {
  const { league, name } = await params;
  const { accent, glow } = getLeagueColors(league);
  const playerName = decodeURIComponent(name);
  const playerUrl = `/${league}/player_historical/${encodeURIComponent(playerName)}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: league.toUpperCase(), href: `/${league}` },
          { name: 'Jugadores', href: `/${league}/players` },
          { name: playerName, href: `/${league}/player_profile/${encodeURIComponent(playerName)}` },
          { name: 'Histórico', href: playerUrl },
        ]}
      />
      <PlayerJsonLd
        name={playerName}
        league={league}
        url={playerUrl}
      />
      <PlayerHistoricalClient
        league={league}
        name={playerName}
        accent={accent}
        glow={glow}
      />
    </>
  );
}
