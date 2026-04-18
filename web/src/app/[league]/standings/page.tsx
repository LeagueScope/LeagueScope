import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import LeaguePagePoller from '@/app/components/LeaguePagePoller';
import './standings.css';

const StandingsClient = dynamic(() => import('./StandingsClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Standings — Next.js SSR wrapper
   Route: /:league/standings
   Fetches team standings on server, passes to interactive client
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Standings — Team Rankings`;
  const description = `Clasificación de equipos de ${leagueUpper}: victorias, derrotas, win rate, estadísticas avanzadas y Pro Vision.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/standings`,
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
      canonical: `${BASE_URL}/${league}/standings`,
    },
  };
}

export interface TeamData {
  id?: number;
  team: string;
  abbr: string;
  slug?: string;
  logo_url?: string;
  wins: number;
  losses: number;
  games: number;
  win_rate: number;
  match_history?: { result: boolean }[];
  // Series-level fields (present only when the serie is BO3+)
  best_of?: number;
  match_wins?: number;
  match_losses?: number;
  match_wr?: number;
  series_history?: { result: boolean }[];
  // General
  avg_duration_formatted?: string;
  unique_champions?: number;
  first_blood_rate?: number;
  first_tower_rate?: number;
  first_dragon_rate?: number;
  first_baron_rate?: number;
  first_herald_rate?: number;
  first_voidgrub_rate?: number;
  first_inhibitor_rate?: number;
  first_atakhan_rate?: number;
  // Per minute
  avg_gpm?: number;
  delta_gpm?: number;
  avg_cspm?: number;
  delta_cspm?: number;
  avg_dpm?: number;
  avg_dtaken_per_min?: number;
  avg_wpm?: number;
  avg_wkpm?: number;
  avg_cwpm?: number;
  // Avg / Game
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  kda?: number;
  // Objectives
  avg_towers?: number;
  avg_towers_lost?: number;
  avg_dragons?: number;
  avg_barons?: number;
  avg_heralds?: number;
  avg_voidgrubs?: number;
  avg_inhibitors?: number;
  avg_atakhans?: number;
  // Damage
  avg_magic_dpm?: number;
  avg_physical_dpm?: number;
  avg_true_dpm?: number;
  avg_magic_dtaken_pm?: number;
  avg_physical_dtaken_pm?: number;
  // Early/Mid/Late
  avg_gold_diff_13?: number;
  avg_cs_diff_13?: number;
  avg_kills_diff_13?: number;
  avg_tower_diff_13?: number;
  avg_gold_diff_20?: number;
  avg_cs_diff_20?: number;
  avg_kills_diff_20?: number;
  avg_tower_diff_20?: number;
  avg_gold_diff_25?: number;
  avg_cs_diff_25?: number;
  avg_kills_diff_25?: number;
  avg_tower_diff_25?: number;
  // Economy
  avg_gold_spent?: number;
  avg_neutral_minions_enemy?: number;
  avg_neutral_minions_team?: number;
  avg_cc_per_min?: number;
  avg_heal_per_min?: number;
  // Side
  blue_wr?: number;
  red_wr?: number;
  [key: string]: unknown;
}

async function getTeams(league: string): Promise<TeamData[]> {
  try {
    return await api<TeamData[]>(`/pg/teams?league=${league}`, { revalidate: 120 });
  } catch {
    return [];
  }
}

export default async function StandingsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);
  const teams = await getTeams(league);
  return (
    <>
      <StandingsClient
        league={league}
        accent={accent}
        initialTeams={teams}
      />
      <LeaguePagePoller league={league} />
    </>
  );
}
