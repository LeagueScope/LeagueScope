import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { BreadcrumbJsonLd, SportsTeamJsonLd } from '@/components/JsonLd';
import './team-history.css';
import './team-historical.css';

const TeamHistoricalClient = dynamic(() => import('./TeamHistoricalClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Team Historical — Next.js SSR wrapper
   Route: /:league/team_historical/:identifier
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; identifier: string }>;
}): Promise<Metadata> {
  const { league, identifier } = await params;
  const leagueUpper = league.toUpperCase();
  const teamName = decodeURIComponent(identifier);
  const title = `${teamName} — Historial | ${leagueUpper}`;
  const description = `Historial completo de ${teamName} en ${leagueUpper}: palmarés, roster, rivales y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/team_historical/${encodeURIComponent(teamName)}`,
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
      canonical: `${BASE_URL}/${league}/team_historical/${encodeURIComponent(teamName)}`,
    },
  };
}

export default async function TeamHistoricalPage({
  params,
}: {
  params: Promise<{ league: string; identifier: string }>;
}) {
  const { league, identifier } = await params;
  const { accent, glow } = getLeagueColors(league);
  const teamName = decodeURIComponent(identifier);
  const teamUrl = `/${league}/team_historical/${encodeURIComponent(teamName)}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: league.toUpperCase(), href: `/${league}` },
          { name: 'Equipos', href: `/${league}/teams` },
          { name: teamName, href: `/${league}/team_profile/${encodeURIComponent(teamName)}` },
          { name: 'Histórico', href: teamUrl },
        ]}
      />
      <SportsTeamJsonLd
        name={teamName}
        abbr={teamName}
        league={league}
        url={teamUrl}
      />
      <TeamHistoricalClient
        league={league}
        identifier={teamName}
        accent={accent}
        glow={glow}
      />
    </>
  );
}
