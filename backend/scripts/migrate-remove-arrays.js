#!/usr/bin/env node
/**
 * migrate-remove-arrays.js
 * Removes redundant bans (INTEGER[]) and player_ids (INTEGER[]) columns
 * from game_teams. These are already normalized in game_picks_bans and game_players.
 */
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

(async () => {
  const pool = new Pool({ connectionString: process.env.PG_DSN });
  try {
    console.log('Dropping game_teams.bans and game_teams.player_ids ...');
    await pool.query('ALTER TABLE game_teams DROP COLUMN IF EXISTS bans, DROP COLUMN IF EXISTS player_ids;');
    console.log('✅ Done — redundant array columns removed.');

    // Verify no arrays remain in game_teams
    const { rows } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'game_teams' AND data_type = 'ARRAY'
    `);
    if (rows.length === 0) {
      console.log('✅ game_teams has zero array columns now.');
    } else {
      console.log('⚠️  Remaining array columns:', rows.map(r => r.column_name));
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
})();
