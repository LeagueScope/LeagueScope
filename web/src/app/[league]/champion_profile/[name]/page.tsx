import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { ChampionJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import './champion-profile.css';

const ChampionProfileClient = dynamic(() => import('./ChampionProfileClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Champion Profile — Next.js SSR shell
   Route: /:league/champion_profile/:name
   Client-side fetching (single API call, no chained logic needed here)
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}): Promise<Metadata> {
  const { league, name } = await params;
  const champName = decodeURIComponent(name);
  const leagueUpper = league.toUpperCase();
  const title = `${champName} — ${leagueUpper} Champion Profile`;
  const description = `Estadísticas detalladas de ${champName} en ${leagueUpper}: win rate, KDA, matchups, items, runas y historial completo.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/champion_profile/${encodeURIComponent(champName)}`,
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
      canonical: `${BASE_URL}/${league}/champion_profile/${encodeURIComponent(champName)}`,
    },
  };
}

export default async function ChampionProfilePage({
  params,
}: {
  params: Promise<{ league: string; name: string }>;
}) {
  const { league, name } = await params;
  const { accent } = getLeagueColors(league);

  const champName = decodeURIComponent(name);
  const leagueUpper = league.toUpperCase();

  return (
    <>
      <ChampionJsonLd
        name={champName}
        league={league}
        url={`/${league}/champion_profile/${encodeURIComponent(champName)}`}
      />
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: leagueUpper, href: `/${league}/overview` },
          { name: champName, href: `/${league}/champion_profile/${encodeURIComponent(champName)}` },
        ]}
      />
      <ChampionProfileClient
        league={league}
        name={name}
        accent={accent}
      />
    </>
  );
}
