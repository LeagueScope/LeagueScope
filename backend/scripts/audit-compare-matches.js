#!/usr/bin/env node
/**
 * Compare 5 matches ingested BEFORE today vs the 2 matches re-ingested today.
 * Checks data completeness: players, runes (9 slots), paths, items, events, assists, frames.
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.PG_DSN });
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', DIM = '\x1b[2m', RST = '\x1b[0m';

async function auditMatch(matchId, label) {
  const { rows: [match] } = await pool.query(`
    SELECT m.id, m.name, m.begin_at, m.status, m.games_ingested_at,
           l.name AS league, s.year, s.season
    FROM matches m
    LEFT JOIN leagues l ON l.id = m.league_id
    LEFT JOIN series s ON s.id = m.serie_id
    WHERE m.id = $1
  `, [matchId]);

  if (!match) { console.log(`  ${RED}Match ${matchId} not found${RST}`); return; }

  console.log(`\n  ${BOLD}[${label}] Match ${matchId}${RST} — ${match.name || '?'} (${match.league} ${match.year} ${match.season || ''})`);
  console.log(`    Ingested: ${match.games_ingested_at?.toISOString?.() || 'NULL'}`);

  const { rows: games } = await pool.query(`SELECT id, position, patch, length, winner_id FROM games WHERE match_id = $1 ORDER BY position`, [matchId]);
  console.log(`    Games: ${games.length}`);

  for (const game of games) {
    const gid = game.id;

    // game_teams
    const { rows: gTeams } = await pool.query(`
      SELECT gt.team_id, gt.color, gt.kills, gt.gold_earned, gt.tower_kills,
             gt.dragon_kills, gt.baron_kills, gt.first_blood,
             gt.chemtech_drake_kills, gt.cloud_drake_kills, gt.hextech_drake_kills,
             gt.infernal_drake_kills, gt.mountain_drake_kills, gt.ocean_drake_kills,
             t.acronym
      FROM game_teams gt LEFT JOIN teams t ON t.id = gt.team_id
      WHERE gt.game_id = $1 ORDER BY gt.color`, [gid]);

    // game_players
    const { rows: gPlayers } = await pool.query(`
      SELECT gp.id AS gp_id, gp.player_id, gp.team_id, gp.champion_id, gp.role,
             gp.kills, gp.deaths, gp.assists, gp.gold_earned, gp.creep_score,
             gp.total_damage_dealt_to_champions, gp.wards_placed,
             gp.rune_primary_path_id, gp.rune_secondary_path_id,
             gp.spell_1_id, gp.spell_2_id, gp.items,
             gp.opponent_id, gp.opponent_champion_id,
             p.name AS player_name
      FROM game_players gp
      LEFT JOIN players p ON p.id = gp.player_id
      WHERE gp.game_id = $1
      ORDER BY gp.team_id, gp.role`, [gid]);

    // game_player_runes (all slots)
    const gpIds = gPlayers.map(p => p.gp_id);
    const { rows: gRunes } = await pool.query(`
      SELECT gpr.game_player_id, gpr.rune_id, gpr.tree, gpr.slot, r.name AS rune_name
      FROM game_player_runes gpr
      LEFT JOIN runes r ON r.id = gpr.rune_id
      WHERE gpr.game_player_id = ANY($1::bigint[])
      ORDER BY gpr.game_player_id, gpr.slot`, [gpIds]);

    // game_picks_bans
    const { rows: [{ count: pbCount }] } = await pool.query(`SELECT COUNT(*) FROM game_picks_bans WHERE game_id = $1`, [gid]);

    // game_events + assists
    const { rows: [{ count: evCount }] } = await pool.query(`SELECT COUNT(*) FROM game_events WHERE game_id = $1`, [gid]);
    const { rows: [{ count: assistCount }] } = await pool.query(`
      SELECT COUNT(*) FROM game_event_assists gea
      JOIN game_events ge ON ge.id = gea.event_id
      WHERE ge.game_id = $1`, [gid]);

    // game_frames
    const { rows: [{ count: frameCount }] } = await pool.query(`SELECT COUNT(*) FROM game_frames WHERE game_id = $1`, [gid]);
    const { rows: [{ count: fpCount }] } = await pool.query(`
      SELECT COUNT(*) FROM game_frame_players gfp
      JOIN game_frames gf ON gf.id = gfp.frame_id
      WHERE gf.game_id = $1`, [gid]);

    // Build per-player rune map
    const runesByPlayer = {};
    for (const r of gRunes) (runesByPlayer[r.game_player_id] ||= []).push(r);

    const teams = gTeams.map(t => `${t.acronym}(${t.color})`).join(' vs ');
    console.log(`\n    Game ${game.position} (${gid}): ${teams} | patch ${game.patch} | ${game.length}s`);
    console.log(`      Teams: kills=${gTeams.map(t=>t.kills).join('/')}, gold=${gTeams.map(t=>t.gold_earned).join('/')}, towers=${gTeams.map(t=>t.tower_kills).join('/')}`);
    console.log(`      PB: ${pbCount} | Events: ${evCount} | Assists(table): ${assistCount} | Frames: ${frameCount} | FramePlayers: ${fpCount}`);

    let allOk = true;
    for (const gp of gPlayers) {
      const runes = runesByPlayer[gp.gp_id] || [];
      const keystone = runes.find(r => r.slot === 0);
      const primary = runes.filter(r => r.slot >= 1 && r.slot <= 3);
      const secondary = runes.filter(r => r.slot >= 4 && r.slot <= 5);
      const shards = runes.filter(r => r.slot >= 6 && r.slot <= 8);
      const issues = [];

      if (runes.length < 9) issues.push(`${runes.length}/9 runes`);
      if (!keystone) issues.push('no keystone');
      if (primary.length < 3) issues.push(`${primary.length}/3 primary`);
      if (secondary.length < 2) issues.push(`${secondary.length}/2 secondary`);
      if (shards.length < 3) issues.push(`${shards.length}/3 shards`);
      if (!gp.rune_primary_path_id) issues.push('no primary_path');
      if (!gp.rune_secondary_path_id) issues.push('no secondary_path');
      if (!gp.items || gp.items.length === 0) issues.push('no items');
      if (!gp.spell_1_id) issues.push('no spell1');
      if (!gp.gold_earned) issues.push('no gold');
      if (gp.total_damage_dealt_to_champions == null) issues.push('no dmg');

      if (issues.length > 0) {
        console.log(`      ${RED}✗ ${gp.player_name} (${gp.role}): ${issues.join(', ')}${RST}`);
        allOk = false;
      } else {
        console.log(`      ${GREEN}✓${RST} ${gp.player_name} (${gp.role}): ${gp.kills}/${gp.deaths}/${gp.assists} | ${runes.length} runes | ${keystone.rune_name} | ${gp.items?.length || 0} items | ${gp.gold_earned}g | ${gp.wards_placed}w`);
      }
    }
    if (allOk && gPlayers.length === 10) {
      console.log(`      ${GREEN}✓ ALL 10 PLAYERS COMPLETE${RST}`);
    }
  }
}

async function main() {
  console.log(`${BOLD}═══ MATCH DATA COMPARISON: Pre-dump vs Post-dump ═══${RST}`);

  // Find 5 recent 2026 matches with full game data that were NOT ingested today
  const today = new Date().toISOString().split('T')[0];
  const { rows: preMatches } = await pool.query(`
    SELECT DISTINCT m.id
    FROM matches m
    JOIN games g ON g.match_id = m.id
    JOIN game_players gp ON gp.game_id = g.id
    JOIN series s ON s.id = m.serie_id
    WHERE s.year = 2026
      AND m.status = 'finished'
      AND m.games_ingested_at IS NOT NULL
      AND m.games_ingested_at::date < $1::date
      AND gp.kills IS NOT NULL
    ORDER BY m.id DESC
    LIMIT 5
  `, [today]);

  console.log(`\n${BOLD}── PRE-DUMP MATCHES (2026, ingested before today) ──${RST}`);
  if (preMatches.length === 0) {
    console.log(`  ${YELLOW}No 2026 matches found ingested before today${RST}`);
  }
  for (const m of preMatches) {
    await auditMatch(m.id, 'PRE-DUMP');
  }

  // The 2 matches we re-ingested today
  console.log(`\n${BOLD}── POST-DUMP MATCHES (re-ingested today) ──${RST}`);
  await auditMatch(1350541, 'TODAY G2vsKC');
  await auditMatch(1402258, 'TODAY VITvsMKOI');

  console.log(`\n${BOLD}═══ COMPARISON COMPLETE ═══${RST}`);
  pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
