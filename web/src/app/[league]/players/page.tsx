import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import './players.css';

const PlayersClient = dynamic(() => import('./PlayersClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Players — Next.js SSR wrapper
   Route: /:league/players
   Fetches player list on server, passes to interactive client
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Players — Player Rankings & Stats`;
  const description = `Ranking de jugadores de ${leagueUpper}: KDA, estadísticas por minuto, Pro Vision avanzada y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/players`,
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
      canonical: `${BASE_URL}/${league}/players`,
    },
  };
}

export interface PlayerData {
  name: string;
  position: string;
  team_abbr: string;
  team_logo_url?: string;
  image_url?: string;
  wins?: number;
  losses?: number;
  games?: number;
  win_rate?: number;
  match_log?: { result: boolean | string }[];
  // KDA
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  kda?: number;
  kill_participation?: number;
  // General
  avg_duration_formatted?: string;
  unique_champions?: number;
  fb_rate?: number;
  first_tower_rate?: number;
  // Per minute
  avg_gpm?: number;
  avg_cspm?: number;
  avg_dpm?: number;
  avg_dtaken_per_min?: number;
  avg_wpm?: number;
  avg_wkpm?: number;
  avg_cwpm?: number;
  // Shares
  avg_damage_share?: number;
  avg_gold_share?: number;
  // Damage
  avg_magic_dpm?: number;
  avg_physical_dpm?: number;
  avg_true_dpm?: number;
  avg_magic_dtaken_pm?: number;
  avg_physical_dtaken_pm?: number;
  // Early/Mid/Late
  avg_cs_diff_13?: number;
  avg_level_diff_13?: number;
  avg_kills_diff_13?: number;
  avg_cs_diff_20?: number;
  avg_level_diff_20?: number;
  avg_kills_diff_20?: number;
  avg_cs_diff_25?: number;
  avg_level_diff_25?: number;
  avg_kills_diff_25?: number;
  // Combat
  double_kills?: number;
  triple_kills?: number;
  quadra_kills?: number;
  penta_kills?: number;
  // Economy
  avg_gold_spent?: number;
  avg_cc_per_min?: number;
  avg_heal_per_min?: number;
  // Side
  blue_wr?: number;
  red_wr?: number;
  [key: string]: unknown;
}

async function getPlayers(league: string): Promise<PlayerData[]> {
  try {
    return await api<PlayerData[]>(`/pg/players?league=${league}`, { revalidate: 120 });
  } catch {
    return [];
  }
}

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);
  const players = await getPlayers(league);

  return (
    <PlayersClient
      league={league}
      accent={accent}
      initialPlayers={players}
    />
  );
}
