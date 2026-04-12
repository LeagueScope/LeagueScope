#!/usr/bin/env node
/**
 * Migration: Remove all JSONB columns and add relational sub-tables.
 *
 * Changes:
 *   1. game_players: DROP rune_shards JSONB
 *   2. game_events: DROP assistants JSONB, CREATE game_event_assists table
 *   3. champion_global_stats: DROP 6 JSONB columns, CREATE 6 relational tables
 *   4. player_career: DROP keystones_json, CREATE player_keystones table
 *   5. team_career: DROP drake_breakdown_json, ADD 6 avg_*_drakes columns
 *   6. DROP 5 pure-JSONB dump tables (match_player_stats, tournament_player_stats,
 *      tournament_team_stats, player_stats, team_stats)
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.PG_DSN });

async function run(sql, label) {
  try {
    await pool.query(sql);
    console.log(`  ✓ ${label}`);
  } catch (e) {
    if (e.code === '42701') console.log(`  - ${label} (column already exists)`);
    else if (e.code === '42703') console.log(`  - ${label} (column already dropped)`);
    else if (e.code === '42P01') console.log(`  - ${label} (table doesn't exist)`);
    else if (e.code === '42P07') console.log(`  - ${label} (table already exists)`);
    else if (e.code === '42710') console.log(`  - ${label} (constraint already exists)`);
    else throw e;
  }
}

async function main() {
  console.log('═══ Migration: Remove JSONB, add relational tables ═══\n');

  // ─── 1. game_players: drop rune_shards ────────────────────────────────
  // CASCADE drops dependent views (v_game_players), we recreate them at the end
  console.log('1. game_players');
  await run('ALTER TABLE game_players DROP COLUMN IF EXISTS rune_shards CASCADE', 'DROP rune_shards (CASCADE)');

  // ─── 2. game_events: drop assistants, create game_event_assists ───────
  console.log('\n2. game_events → game_event_assists');
  // Migrate existing assistants data before dropping
  await run(`
    CREATE TABLE IF NOT EXISTS game_event_assists (
      event_id   BIGINT NOT NULL REFERENCES game_events(id) ON DELETE CASCADE,
      player_id  INTEGER NOT NULL,
      champion_id INTEGER,
      PRIMARY KEY (event_id, player_id)
    )`, 'CREATE game_event_assists');
  await run('CREATE INDEX IF NOT EXISTS idx_event_assists_player ON game_event_assists(player_id)',
    'CREATE idx_event_assists_player');

  // Migrate existing JSONB assistants data
  const { rows: [{ exists: hasAssistants }] } = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'game_events' AND column_name = 'assistants'
    )`);
  if (hasAssistants) {
    const { rowCount } = await pool.query(`
      INSERT INTO game_event_assists (event_id, player_id, champion_id)
      SELECT ge.id, (a->>'player_id')::int, (a->>'champion_id')::int
      FROM game_events ge, jsonb_array_elements(ge.assistants) AS a
      WHERE ge.assistants IS NOT NULL AND jsonb_typeof(ge.assistants) = 'array'
      ON CONFLICT DO NOTHING
    `);
    console.log(`  ✓ Migrated ${rowCount} assist rows from JSONB`);
    await run('ALTER TABLE game_events DROP COLUMN assistants', 'DROP assistants');
  }

  // ─── 3. champion_global_stats: drop 6 JSONB, create 6 tables ─────────
  console.log('\n3. champion_global_stats → 6 relational tables');

  // Create tables first
  await run(`
    CREATE TABLE IF NOT EXISTS champion_role_stats (
      champion_id  INTEGER NOT NULL,
      serie_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      role         player_role NOT NULL,
      games        INTEGER DEFAULT 0,
      wins         INTEGER DEFAULT 0,
      losses       INTEGER DEFAULT 0,
      PRIMARY KEY (champion_id, serie_id, role),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_role_stats');

  await run(`
    CREATE TABLE IF NOT EXISTS champion_top_players (
      champion_id  INTEGER NOT NULL,
      serie_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      player_name  TEXT,
      team_name    TEXT,
      games        INTEGER DEFAULT 0,
      wins         INTEGER DEFAULT 0,
      kda          REAL,
      PRIMARY KEY (champion_id, serie_id, player_id),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_top_players');
  await run('CREATE INDEX IF NOT EXISTS idx_ctp_player ON champion_top_players(player_id)',
    'CREATE idx_ctp_player');

  await run(`
    CREATE TABLE IF NOT EXISTS champion_matchups (
      champion_id          INTEGER NOT NULL,
      serie_id             INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      opponent_champion_id INTEGER NOT NULL,
      opponent_name        TEXT,
      games                INTEGER DEFAULT 0,
      wins                 INTEGER DEFAULT 0,
      PRIMARY KEY (champion_id, serie_id, opponent_champion_id),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_matchups');

  await run(`
    CREATE TABLE IF NOT EXISTS champion_items (
      champion_id  INTEGER NOT NULL,
      serie_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      count        INTEGER DEFAULT 0,
      PRIMARY KEY (champion_id, serie_id, item_id),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_items');
  await run('CREATE INDEX IF NOT EXISTS idx_ci_item ON champion_items(item_id)',
    'CREATE idx_ci_item');

  await run(`
    CREATE TABLE IF NOT EXISTS champion_keystones (
      champion_id  INTEGER NOT NULL,
      serie_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      rune_id      INTEGER NOT NULL REFERENCES runes(id) ON DELETE CASCADE,
      rune_name    TEXT,
      games        INTEGER DEFAULT 0,
      wins         INTEGER DEFAULT 0,
      PRIMARY KEY (champion_id, serie_id, rune_id),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_keystones');

  await run(`
    CREATE TABLE IF NOT EXISTS champion_patch_stats (
      champion_id  INTEGER NOT NULL,
      serie_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      patch        TEXT NOT NULL,
      games        INTEGER DEFAULT 0,
      wins         INTEGER DEFAULT 0,
      bans         INTEGER DEFAULT 0,
      PRIMARY KEY (champion_id, serie_id, patch),
      FOREIGN KEY (champion_id, serie_id) REFERENCES champion_global_stats(champion_id, serie_id) ON DELETE CASCADE
    )`, 'CREATE champion_patch_stats');

  // Drop JSONB columns
  for (const col of ['roles_json', 'top_players_json', 'matchups_json', 'items_json', 'keystones_json', 'patch_breakdown_json']) {
    await run(`ALTER TABLE champion_global_stats DROP COLUMN IF EXISTS ${col}`, `DROP ${col}`);
  }

  // ─── 4. player_career: drop keystones_json, create player_keystones ───
  console.log('\n4. player_career → player_keystones');
  await run(`
    CREATE TABLE IF NOT EXISTS player_keystones (
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      serie_id   INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      rune_id    INTEGER NOT NULL REFERENCES runes(id) ON DELETE CASCADE,
      rune_name  TEXT,
      games      INTEGER DEFAULT 0,
      wins       INTEGER DEFAULT 0,
      PRIMARY KEY (player_id, serie_id, rune_id)
    )`, 'CREATE player_keystones');
  await run('CREATE INDEX IF NOT EXISTS idx_pk_serie ON player_keystones(serie_id)',
    'CREATE idx_pk_serie');
  await run('ALTER TABLE player_career DROP COLUMN IF EXISTS keystones_json', 'DROP keystones_json');

  // ─── 5. team_career: drop drake_breakdown_json, add 6 columns ────────
  console.log('\n5. team_career: drake columns');
  for (const col of ['avg_chemtech_drakes', 'avg_cloud_drakes', 'avg_hextech_drakes',
                      'avg_infernal_drakes', 'avg_mountain_drakes', 'avg_ocean_drakes']) {
    await run(`ALTER TABLE team_career ADD COLUMN IF NOT EXISTS ${col} REAL`, `ADD ${col}`);
  }
  await run('ALTER TABLE team_career DROP COLUMN IF EXISTS drake_breakdown_json', 'DROP drake_breakdown_json');

  // ─── 6. Drop 5 JSONB dump tables ─────────────────────────────────────
  console.log('\n6. Drop JSONB dump tables');
  for (const tbl of ['match_player_stats', 'tournament_player_stats', 'tournament_team_stats',
                      'player_stats', 'team_stats']) {
    await run(`DROP TABLE IF EXISTS ${tbl} CASCADE`, `DROP ${tbl}`);
  }

  // ─── 7. Recreate views without JSONB columns ──────────────────────────
  console.log('\n7. Recreate views');
  await run(`
    CREATE OR REPLACE VIEW v_game_players AS
    SELECT gp.*,
           ca.canonical_id AS canonical_champion_id,
           c.name AS champion_name,
           p.name AS player_name,
           t.name AS team_name
    FROM game_players gp
    LEFT JOIN champion_aliases ca ON gp.champion_id = ca.pandascore_id
    LEFT JOIN champions c ON ca.canonical_id = c.id
    LEFT JOIN players p ON gp.player_id = p.id
    LEFT JOIN teams t ON gp.team_id = t.id
  `, 'RECREATE v_game_players');

  console.log('\n═══ Migration complete ═══');
  pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
