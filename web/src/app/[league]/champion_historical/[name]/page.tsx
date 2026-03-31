import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { BreadcrumbJsonLd, ChampionJsonLd } from '@/components/JsonLd';
import './champion-history.css';
import '../../record/record.css';

const ChampionHistoricalClient = dynamic(() => import('./ChampionHistoricalClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Champion Historical — Next.js SSR wrapper
   Route: /:league/champion_historical/:name
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://leaguescope.gg';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}): Promise<Metadata> {
  const { league, name } = await params;
  const leagueUpper = league.toUpperCase();
  const champName = decodeURIComponent(name);
  const title = `${champName} — Historial | ${leagueUpper}`;
  const description = `Historial completo de ${champName}: tendencia de rendimiento, presencia por parche, mejores jugadores y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/champion_historical/${encodeURIComponent(champName)}`,
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
      canonical: `${BASE_URL}/${league}/champion_historical/${encodeURIComponent(champName)}`,
    },
  };
}

export default async function ChampionHistoricalPage({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}) {
  const { league, name } = await params;
  const { accent, glow } = getLeagueColors(league);
  const champName = decodeURIComponent(name);
  const champUrl = `/${league}/champion_historical/${encodeURIComponent(champName)}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: league.toUpperCase(), href: `/${league}` },
          { name: 'Campeones', href: `/${league}/champions` },
          { name: champName, href: `/${league}/champion_profile/${encodeURIComponent(champName)}` },
          { name: 'Histórico', href: champUrl },
        ]}
      />
      <ChampionJsonLd
        name={champName}
        league={league}
        url={champUrl}
      />
      <ChampionHistoricalClient
        league={league}
        name={champName}
        accent={accent}
        glow={glow}
      />
    </>
  );
}
