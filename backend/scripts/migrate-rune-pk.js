#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.PG_DSN });

async function main() {
  // 1. Check current state
  const { rows: dupes } = await pool.query(`
    SELECT game_player_id, slot, COUNT(*) AS cnt
    FROM game_player_runes
    WHERE slot IS NOT NULL
    GROUP BY game_player_id, slot
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  console.log(`Duplicate (game_player_id, slot) pairs: ${dupes.length}${dupes.length === 20 ? '+' : ''}`);
  for (const d of dupes.slice(0, 5)) {
    console.log(`  gp=${d.game_player_id} slot=${d.slot} count=${d.cnt}`);
  }

  // 2. Delete NULL slots
  const { rowCount: nulled } = await pool.query('DELETE FROM game_player_runes WHERE slot IS NULL');
  console.log(`Deleted ${nulled} rows with NULL slot`);

  // 3. Deduplicate: keep one row per (game_player_id, slot), remove extras
  const { rowCount: deduped } = await pool.query(`
    DELETE FROM game_player_runes a
    USING game_player_runes b
    WHERE a.game_player_id = b.game_player_id
      AND a.slot = b.slot
      AND a.rune_id > b.rune_id
  `);
  console.log(`Deduped ${deduped} rows`);

  // 4. Verify no more dupes
  const { rows: check } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT game_player_id, slot FROM game_player_runes
      GROUP BY game_player_id, slot HAVING COUNT(*) > 1
    ) sub
  `);
  console.log(`Remaining dupes: ${check[0].cnt}`);

  if (Number(check[0].cnt) > 0) {
    console.log('Still have dupes — using ctid fallback...');
    await pool.query(`
      DELETE FROM game_player_runes a
      USING game_player_runes b
      WHERE a.game_player_id = b.game_player_id
        AND a.slot = b.slot
        AND a.ctid > b.ctid
    `);
    const { rows: check2 } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT game_player_id, slot FROM game_player_runes
        GROUP BY game_player_id, slot HAVING COUNT(*) > 1
      ) sub
    `);
    console.log(`After ctid dedup: ${check2[0].cnt} dupes remaining`);
  }

  // 5. Drop old PK (may already be dropped)
  try {
    await pool.query('ALTER TABLE game_player_runes DROP CONSTRAINT game_player_runes_pkey');
    console.log('Dropped old PK');
  } catch (e) {
    console.log('Old PK already dropped or does not exist');
  }

  // 6. Set slot NOT NULL + add new PK
  await pool.query('ALTER TABLE game_player_runes ALTER COLUMN slot SET NOT NULL');
  await pool.query('ALTER TABLE game_player_runes ADD PRIMARY KEY (game_player_id, slot)');
  console.log('New PK (game_player_id, slot) created!');

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
