/* ═══════════════════════════════════════════════════════════════════════════
   Shared TypeScript types for the LeagueScope API responses
   Matches actual backend output from pgHome.js getHomeOverviewPg
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MiniStanding {
  abbr: string;
  name: string;
  logo_url: string | null;
  wins: number;
  losses: number;
  win_rate: number;
  games: number;
}

export interface ChampionPlayed {
  name: string;
  image_url: string | null;
  games: number;
  bans: number;
  winRate: number;
}

export interface BlueRedStat {
  label: string;
  blue: number;
  red: number;
}

export interface RecentMatch {
  matchid: number;
  isSeries: boolean;
  numberOfGames: number;
  winner: 'blue' | 'red';
  dateStr: string | null;
  blue: { abbr: string; score: number; kills: number; logo_url: string | null };
  red: { abbr: string; score: number; kills: number; logo_url: string | null };
}

export interface UpcomingMatch {
  id: number;
  begin_at: string;
  opponents: Array<{
    opponent: {
      acronym: string;
      dark_mode_image_url: string | null;
      image_url: string | null;
    };
  }>;
}

export interface BestPlayer {
  name: string;
  playerName: string;
  image_url: string | null;
  role: string;
  team: string;
  team_logo_url: string | null;
  kda: number;
  value: number;
}

export interface LeagueOverview {
  region: string;
  split: string | null;
  miniStandings: MiniStanding[];
  championsPlayed: ChampionPlayed[];
  blueVsRed: BlueRedStat[] | null;
  recentMatches: RecentMatch[];
  upcoming: UpcomingMatch[];
  bestPlayers: BestPlayer[];
  teamPerformance: Record<string, unknown>;
  teamRankings: Record<string, unknown>;
}

export interface MetaChampion {
  championName: string;
  image_url: string | null;
  picks: number;
  bans: number;
  winRate: number;
  earlyPickRate: number;
}

export interface MetaSnapshot {
  patch: string | null;
  totalGames: number;
  mostPickedChampions: MetaChampion[];
  mostBannedChampions: MetaChampion[];
  highestWinRateChampions: MetaChampion[];
  priorityChampionsBlue: MetaChampion[];
  priorityChampionsRed: MetaChampion[];
}

export interface HomeData {
  leagueOverviews: LeagueOverview[];
  tier3Leagues: LeagueOverview[];
  tier4Leagues: LeagueOverview[];
  metaSnapshot: MetaSnapshot | null;
  teamHighlights: unknown;
}
