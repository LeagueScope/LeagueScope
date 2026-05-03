/**
 * Plantilla piloto: WR de un equipo en un split.
 *
 * Param ejemplo: { team: 'KC', league: 'lec', year: 2026, season: 'spring' }
 *
 * Devuelve total de partidas, victorias, derrotas y win rate.
 */

import { streamerPool } from '../../casterDb';
import type { ParamDef } from '../validate';

export const ALLOWED_LEAGUES = [
  'lec', 'lck', 'lpl', 'lcs', 'cblol', 'lcp', 'vcs', 'ljl', 'tcl',
  'lfl', 'les', 'prm', 'nlc', 'lit', 'ebl',
  'msi', 'worlds', 'firststand',
] as const;

export const ALLOWED_SEASONS = ['spring', 'summer', 'winter', 'all'] as const;

const params: readonly ParamDef[] = [
  { name: 'team', type: 'string', label: 'Equipo (abbr o nombre)', maxLength: 50,
    hint: 'Ej: G2, KC, T1, FNATIC...' },
  { name: 'league', type: 'enum', label: 'Liga', values: ALLOWED_LEAGUES },
  { name: 'year', type: 'int', label: 'Año', min: 2018, max: 2030 },
  { name: 'season', type: 'enum', label: 'Split', values: ALLOWED_SEASONS },
] as const;

export interface TeamWinsResult {
  team: string;
  league: string;
  year: number;
  season: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
}

async function run(p: Record<string, string | number>): Promise<TeamWinsResult> {
  const team = String(p.team).trim();
  const league = String(p.league);
  const year = Number(p.year);
  const season = String(p.season);

  // El slug en la BD es "league-of-legends-XXX"
  const leagueSlug = `league-of-legends-${league}`;

  // Si season=all, no filtramos por season
  const seasonFilter = season === 'all' ? '' : 'AND s.season ILIKE $4';
  const args: Array<string | number> = [team, leagueSlug, year];
  if (season !== 'all') args.push(`%${season}%`);

  const { rows } = await streamerPool.query<{
    games: string;
    wins: string;
    losses: string;
  }>(`
    WITH lec_games AS (
      SELECT g.id, g.winner_id, t.id AS team_id, t.acronym AS team_abbr, t.name AS team_name
      FROM games g
      JOIN game_teams gt ON gt.game_id = g.id
      JOIN teams t ON t.id = gt.team_id
      JOIN series s ON s.id = g.serie_id
      JOIN leagues l ON l.id = s.league_id
      WHERE l.slug = $2
        AND s.year = $3
        ${seasonFilter}
        AND g.finished = true
        AND g.length > 60
        AND (LOWER(t.acronym) = LOWER($1) OR LOWER(t.name) LIKE LOWER('%' || $1 || '%'))
    )
    SELECT
      COUNT(*)                                      AS games,
      COUNT(*) FILTER (WHERE winner_id = team_id)   AS wins,
      COUNT(*) FILTER (WHERE winner_id != team_id)  AS losses
    FROM lec_games
  `, args);

  const r = rows[0];
  const games = parseInt(r?.games || '0', 10);
  const wins = parseInt(r?.wins || '0', 10);
  const losses = parseInt(r?.losses || '0', 10);
  const win_rate = games > 0 ? Math.round((wins / games) * 1000) / 10 : 0;

  return {
    team,
    league: league.toUpperCase(),
    year,
    season,
    games,
    wins,
    losses,
    win_rate,
  };
}

export const teamWinsInSplit = {
  id: 'team_wins_in_split',
  label: 'Victorias de un equipo en un split',
  description: 'Total de partidas y win rate de un equipo en una liga, año y split concretos.',
  category: 'Equipos',
  params,
  run,
};
