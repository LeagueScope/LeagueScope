import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import './record.css';

const RecordClient = dynamic(() => import('./RecordClient'));

/* ═══════════════════════════════════════════════════════════════════════════
   Record — Next.js SSR wrapper
   Route: /:league/record
   Fetches match list + tournament on server, passes to interactive client
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Record — Match History`;
  const description = `Historial de partidas de ${leagueUpper}: resultados, estadísticas detalladas, gráficos de oro y timeline de eventos.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${league}/record`,
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
      canonical: `${BASE_URL}/${league}/record`,
    },
  };
}

interface MatchTeam {
  id: number;
  name: string;
  abbr: string;
  acronym: string;
  logo_url?: string;
  score: number;
}

interface MatchGame {
  id: number;
  length: number;
  position: number;
  winner?: { id: number; name: string; acronym: string } | null;
}

export interface MatchData {
  id: number;
  matchid: number;
  status: string;
  number_of_games: number;
  best_of: number;
  scheduled_at?: string;
  date?: string;
  date_str?: string;
  begin_at?: string;
  winner_id?: number;
  winner?: { id: number; name: string; acronym: string } | null;
  match_label?: string | null;
  teamA: MatchTeam;
  teamB: MatchTeam;
  games: MatchGame[];
}

export interface TournamentData {
  total_games?: number;
  avg_duration?: number;
  avg_duration_formatted?: string;
}

async function getMatches(league: string): Promise<MatchData[]> {
  try {
    return await api<MatchData[]>(`/pg/matches?league=${league}`, { revalidate: 60 });
  } catch {
    return [];
  }
}

async function getTournament(league: string): Promise<TournamentData> {
  try {
    return await api<TournamentData>(`/pg/tournament?league=${league}`, { revalidate: 120 });
  } catch {
    return {};
  }
}

export default async function RecordPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);

  const [matches, tournament] = await Promise.all([
    getMatches(league),
    getTournament(league),
  ]);

  return (
    <RecordClient
      league={league}
      accent={accent}
      initialMatches={matches}
      tournament={tournament}
    />
  );
}
