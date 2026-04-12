#!/usr/bin/env node
/**
 * Database integrity audit script.
 * Captures a complete snapshot of:
 *   1. Schema: all tables, columns, types, constraints
 *   2. Row counts per table
 *   3. Deep data comparison of N oldest + N newest matches
 *      (game_teams, game_players, game_player_runes, game_events, picks_bans, etc.)
 *
 * Usage:
 *   node scripts/audit-db-integrity.js
 *   node scripts/audit-db-integrity.js --save   # saves JSON snapshot to disk
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.PG_DSN });
const SAVE = process.argv.includes('--save');
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', DIM = '\x1b[2m', RST = '\x1b[0m';

async function main() {
  const snapshot = {};

  // ═══════════════════════════════════════════════════════════════════
  // 1. SCHEMA: all tables + columns
  // ═══════════════════════════════════════════════════════════════════
  console.log(`${BOLD}═══ 1. SCHEMA SNAPSHOT ═══${RST}\n`);

  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`  Tables: ${tables.length}`);

  snapshot.tables = {};
  for (const { table_name } of tables) {
    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table_name]);

    const { rows: constraints } = await pool.query(`
      SELECT tc.constraint_name, tc.constraint_type,
             kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = $1 AND tc.table_schema = 'public'
      ORDER BY tc.constraint_type, kcu.column_name
    `, [table_name]);

    snapshot.tables[table_name] = {
      columns: cols.map(c => ({
        name: c.column_name,
        type: c.udt_name,
        nullable: c.is_nullable === 'YES',
      })),
      constraints: constraints.map(c => ({
        name: c.constraint_name,
        type: c.constraint_type,
        column: c.column_name,
      })),
    };

    const jsonbCols = cols.filter(c => c.udt_name === 'jsonb');
    const colSummary = jsonbCols.length > 0
      ? ` ${YELLOW}(${jsonbCols.length} JSONB: ${jsonbCols.map(c => c.column_name).join(', ')})${RST}`
      : '';
    console.log(`  ${GREEN}✓${RST} ${table_name}: ${cols.length} columns${colSummary}`);
  }

  // Views
  const { rows: views } = await pool.query(`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log(`\n  Views: ${views.map(v => v.table_name).join(', ')}`);

  // ═══════════════════════════════════════════════════════════════════
  // 2. ROW COUNTS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}═══ 2. ROW COUNTS ═══${RST}\n`);

  snapshot.rowCounts = {};
  for (const { table_name } of tables) {
    const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM "${table_name}"`);
    snapshot.rowCounts[table_name] = Number(count);
    console.log(`  ${table_name}: ${Number(count).toLocaleString()}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. MATCH DATA COMPARISON: 5 oldest + 5 newest finished matches
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}═══ 3. MATCH DATA AUDIT (5 oldest + 5 newest) ═══${RST}\n`);

  const { rows: oldMatches } = await pool.query(`
    SELECT m.id, m.name, m.begin_at, m.status, m.games_ingested_at,
           l.name AS league
    FROM matches m
    LEFT JOIN leagues l ON l.id = m.league_id
    WHERE m.status = 'finished' AND m.games_ingested_at IS NOT NULL
    ORDER BY m.games_ingested_at ASC NULLS LAST, m.begin_at ASC
    LIMIT 5
  `);
  const { rows: newMatches } = await pool.query(`
    SELECT m.id, m.name, m.begin_at, m.status, m.games_ingested_at,
           l.name AS league
    FROM matches m
    LEFT JOIN leagues l ON l.id = m.league_id
    WHERE m.status = 'finished' AND m.games_ingested_at IS NOT NULL
    ORDER BY m.games_ingested_at DESC NULLS LAST, m.begin_at DESC
    LIMIT 5
  `);

  const allMatches = [
    ...oldMatches.map(m => ({ ...m, _group: 'OLDEST' })),
    ...newMatches.map(m => ({ ...m, _group: 'NEWEST' })),
  ];

  snapshot.matchAudits = [];

  for (const match of allMatches) {
    if (match._group !== allMatches[0]?._group || match === allMatches[0]) {
      if (match._group === 'NEWEST' && allMatches.find(m => m._group === 'OLDEST')) {
        console.log(`\n  ${BOLD}── NEWEST 5 (most recently ingested) ──${RST}`);
      } else if (match === allMatches[0]) {
        console.log(`  ${BOLD}── OLDEST 5 (first ingested) ──${RST}`);
      }
    }

    const matchId = match.id;
    console.log(`\n  ${BOLD}Match ${matchId}${RST} — ${match.name || '?'} (${match.league || '?'}) ingested: ${match.games_ingested_at?.toISOString?.() || '?'}`);

    // Games
    const { rows: games } = await pool.query(`SELECT id, position, patch, length, winner_id FROM games WHERE match_id = $1 ORDER BY position`, [matchId]);
    console.log(`    Games: ${games.length}`);

    const audit = {
      match_id: matchId,
      match_name: match.name,
      league: match.league,
      group: match._group,
      ingested_at: match.games_ingested_at,
      games: [],
    };

    for (const game of games) {
      const gid = game.id;

      // game_teams
      const { rows: gTeams } = await pool.query(`
        SELECT gt.team_id, gt.color, gt.kills, gt.gold_earned, gt.tower_kills,
               gt.dragon_kills, gt.baron_kills, gt.first_blood, t.acronym
        FROM game_teams gt LEFT JOIN teams t ON t.id = gt.team_id
        WHERE gt.game_id = $1 ORDER BY gt.color`, [gid]);

      // game_players
      const { rows: gPlayers } = await pool.query(`
        SELECT gp.id AS gp_id, gp.player_id, gp.team_id, gp.champion_id, gp.role,
               gp.kills, gp.deaths, gp.assists, gp.gold_earned, gp.creep_score,
               gp.rune_primary_path_id, gp.rune_secondary_path_id,
               gp.spell_1_id, gp.spell_2_id, gp.items,
               p.name AS player_name,
               CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='game_players' AND column_name='rune_shards') THEN 'YES' ELSE 'NO' END AS has_rune_shards_col
        FROM game_players gp
        LEFT JOIN players p ON p.id = gp.player_id
        WHERE gp.game_id = $1
        ORDER BY gp.team_id, gp.role`, [gid]);

      // game_player_runes
      const { rows: gRunes } = await pool.query(`
        SELECT gpr.game_player_id, gpr.rune_id, gpr.tree, gpr.slot, r.name AS rune_name
        FROM game_player_runes gpr
        LEFT JOIN runes r ON r.id = gpr.rune_id
        WHERE gpr.game_player_id = ANY($1::bigint[])
        ORDER BY gpr.game_player_id, gpr.slot`, [gPlayers.map(p => p.gp_id)]);

      // game_picks_bans
      const { rows: gPB } = await pool.query(`
        SELECT type, champion_id, team_id, pick_turn FROM game_picks_bans
        WHERE game_id = $1 ORDER BY pick_turn`, [gid]);

      // game_events
      const { rows: gEvents } = await pool.query(`
        SELECT type, timestamp, killer_player_id, victim_player_id, is_first,
               CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='game_events' AND column_name='assistants') THEN 'YES' ELSE 'NO' END AS has_assistants_col
        FROM game_events WHERE game_id = $1 ORDER BY timestamp`, [gid]);

      // game_event_assists (if table exists)
      let gAssists = [];
      try {
        const { rows } = await pool.query(`
          SELECT gea.event_id, gea.player_id, gea.champion_id
          FROM game_event_assists gea
          JOIN game_events ge ON ge.id = gea.event_id
          WHERE ge.game_id = $1
          ORDER BY gea.event_id, gea.player_id`, [gid]);
        gAssists = rows;
      } catch (e) { /* table may not exist yet */ }

      // game_frames
      const { rows: [{ count: frameCount }] } = await pool.query(`SELECT COUNT(*) FROM game_frames WHERE game_id = $1`, [gid]);

      // game_frame_players
      const { rows: [{ count: fpCount }] } = await pool.query(`
        SELECT COUNT(*) FROM game_frame_players gfp
        JOIN game_frames gf ON gf.id = gfp.frame_id
        WHERE gf.game_id = $1`, [gid]);

      const runesByPlayer = {};
      for (const r of gRunes) {
        (runesByPlayer[r.game_player_id] ||= []).push(r);
      }

      const playerSummaries = gPlayers.map(gp => {
        const runes = runesByPlayer[gp.gp_id] || [];
        const keystone = runes.find(r => r.slot === 0);
        const primaryPerks = runes.filter(r => r.slot >= 1 && r.slot <= 3);
        const secondaryPerks = runes.filter(r => r.slot >= 4 && r.slot <= 5);
        const shardSlots = runes.filter(r => r.slot >= 6 && r.slot <= 8);

        return {
          player: gp.player_name,
          champion_id: gp.champion_id,
          role: gp.role,
          kda: `${gp.kills}/${gp.deaths}/${gp.assists}`,
          gold: gp.gold_earned,
          cs: gp.creep_score,
          runes_total: runes.length,
          keystone: keystone?.rune_name || null,
          primary_perks: primaryPerks.length,
          secondary_perks: secondaryPerks.length,
          shard_slots: shardSlots.length,
          primary_path_id: gp.rune_primary_path_id,
          secondary_path_id: gp.rune_secondary_path_id,
          spells: [gp.spell_1_id, gp.spell_2_id],
          items_count: gp.items?.length || 0,
          has_rune_shards_col: gp.has_rune_shards_col,
        };
      });

      const gameAudit = {
        game_id: gid,
        position: game.position,
        patch: game.patch,
        length: game.length,
        teams: gTeams.map(t => ({
          acronym: t.acronym,
          color: t.color,
          kills: t.kills,
          gold: t.gold_earned,
          towers: t.tower_kills,
          dragons: t.dragon_kills,
          barons: t.baron_kills,
          first_blood: t.first_blood,
        })),
        players: playerSummaries,
        picks_bans: gPB.length,
        events: gEvents.length,
        event_assists_table: gAssists.length,
        has_assistants_col: gEvents[0]?.has_assistants_col || 'N/A',
        frames: Number(frameCount),
        frame_players: Number(fpCount),
      };

      audit.games.push(gameAudit);

      // Print summary
      const teams = gTeams.map(t => `${t.acronym}(${t.color})`).join(' vs ');
      console.log(`    Game ${game.position} (${gid}): ${teams} | patch ${game.patch} | ${game.length}s`);
      console.log(`      Players: ${gPlayers.length} | Rune rows: ${gRunes.length} | PB: ${gPB.length} | Events: ${gEvents.length} | Assists(table): ${gAssists.length}`);
      console.log(`      Frames: ${frameCount} | FramePlayers: ${fpCount}`);

      // Check data completeness per player
      let issues = [];
      for (const ps of playerSummaries) {
        if (ps.runes_total < 9) issues.push(`${ps.player}: only ${ps.runes_total}/9 runes`);
        if (ps.shard_slots < 3) issues.push(`${ps.player}: only ${ps.shard_slots}/3 shards`);
        if (!ps.keystone) issues.push(`${ps.player}: no keystone`);
        if (!ps.primary_path_id) issues.push(`${ps.player}: no primary path`);
        if (ps.items_count === 0) issues.push(`${ps.player}: no items`);
      }
      if (issues.length > 0) {
        console.log(`      ${RED}Issues: ${issues.join('; ')}${RST}`);
      } else {
        console.log(`      ${GREEN}All players complete (9 runes, paths, items)${RST}`);
      }
    }

    snapshot.matchAudits.push(audit);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. STATS TABLES CHECK
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}═══ 4. STATS TABLES CHECK ═══${RST}\n`);

  // Check which JSONB dump tables still exist
  for (const tbl of ['match_player_stats', 'tournament_player_stats', 'tournament_team_stats', 'player_stats', 'team_stats']) {
    const { rows: [{ exists }] } = await pool.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')
    `, [tbl]);
    console.log(`  ${tbl}: ${exists ? YELLOW + 'EXISTS' + RST : DIM + 'dropped' + RST}`);
  }

  // Check new relational tables
  for (const tbl of ['champion_role_stats', 'champion_top_players', 'champion_matchups', 'champion_items', 'champion_keystones', 'champion_patch_stats', 'player_keystones', 'game_event_assists']) {
    const { rows: [{ exists }] } = await pool.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')
    `, [tbl]);
    if (exists) {
      const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM "${tbl}"`);
      console.log(`  ${tbl}: ${GREEN}EXISTS${RST} (${Number(count).toLocaleString()} rows)`);
    } else {
      console.log(`  ${tbl}: ${DIM}not yet created${RST}`);
    }
  }

  // Check JSONB columns remaining
  console.log(`\n  ${BOLD}Remaining JSONB columns:${RST}`);
  const { rows: jsonbCols } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND udt_name = 'jsonb'
    ORDER BY table_name, column_name
  `);
  if (jsonbCols.length === 0) {
    console.log(`    ${GREEN}NONE — fully relational!${RST}`);
  } else {
    for (const c of jsonbCols) {
      console.log(`    ${YELLOW}${c.table_name}.${c.column_name}${RST}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SAVE
  // ═══════════════════════════════════════════════════════════════════
  if (SAVE) {
    const filename = `db-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2));
    console.log(`\n${GREEN}Snapshot saved: ${filename}${RST}`);
  }

  console.log(`\n${BOLD}═══ AUDIT COMPLETE ═══${RST}`);
  pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
