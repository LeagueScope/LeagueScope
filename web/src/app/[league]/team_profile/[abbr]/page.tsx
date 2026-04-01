import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { getLeagueColors } from '@/lib/leagueColors';
import { SportsTeamJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import './team-profile.css';

const TeamProfileClient = dynamic(() => import('./TeamProfileClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   TeamProfile — Next.js SSR shell
   Route: /:league/team_profile/:abbr
   Data fetching stays client-side due to chained/fallback logic
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; abbr: string }>;
}): Promise<Metadata> {
  const { league, abbr } = await params;
  const leagueUpper = league.toUpperCase();
  const abbrUpper = abbr.toUpperCase();
  const title = `${abbrUpper} — ${leagueUpper} Team Profile`;
  const description = `Perfil del equipo ${abbrUpper} en ${leagueUpper}: estadísticas, plantilla, historial de series y clasificación.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/team_profile/${abbrUpper}`,
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
      canonical: `${BASE_URL}/${league}/team_profile/${abbrUpper}`,
    },
  };
}

export default async function TeamProfilePage({
  params,
}: {
  params: Promise<{ league: string; abbr: string }>;
}) {
  const { league, abbr } = await params;
  const { accent } = getLeagueColors(league);

  const abbrUpper = abbr.toUpperCase();
  const leagueUpper = league.toUpperCase();

  return (
    <>
      <SportsTeamJsonLd
        name={abbrUpper}
        abbr={abbrUpper}
        league={league}
        url={`/${league}/team_profile/${abbrUpper}`}
      />
      <BreadcrumbJsonLd
        items={[
          { name: 'Inicio', href: '/' },
          { name: leagueUpper, href: `/${league}/overview` },
          { name: abbrUpper, href: `/${league}/team_profile/${abbrUpper}` },
        ]}
      />
      <TeamProfileClient
        league={league}
        abbr={abbr}
        accent={accent}
      />
    </>
  );
}
