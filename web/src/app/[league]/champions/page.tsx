import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import './champions.css';

const ChampionsClient = dynamic(() => import('./ChampionsClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Champions — Next.js SSR wrapper
   Route: /:league/champions
   Fetches champion list on server, passes to interactive client
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Champions — Champion Stats & Meta`;
  const description = `Estadísticas de campeones en ${leagueUpper}: pick rate, ban rate, win rate, KDA, Pro Vision avanzada y más.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/champions`,
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
      canonical: `${BASE_URL}/${league}/champions`,
    },
  };
}

export interface ChampionData {
  name: string;
  image_url?: string;
  position?: string;
  position_breakdown?: Record<string, number>;
  wins?: number;
  losses?: number;
  games?: number;
  picks?: number;
  win_rate?: number;
  pick_rate?: number;
  bans?: number;
  ban_rate?: number;
  presence?: number;
  // KDA
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  kda?: number;
  kill_participation?: number;
  // Per minute
  avg_gpm?: number;
  avg_cspm?: number;
  avg_dpm?: number;
  avg_dtaken_per_min?: number;
  // Combat
  fb_rate?: number;
  // Side
  blue_wr?: number;
  red_wr?: number;
  // Meta
  avg_duration_formatted?: string;
  players_count?: number;
  [key: string]: unknown;
}

async function getChampions(league: string): Promise<ChampionData[]> {
  try {
    return await api<ChampionData[]>(`/pg/champions?league=${league}`, { revalidate: 120 });
  } catch {
    return [];
  }
}

export default async function ChampionsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);
  const champions = await getChampions(league);

  return (
    <ChampionsClient
      league={league}
      accent={accent}
      initialChampions={champions}
    />
  );
}
