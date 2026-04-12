#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.PG_DSN });

async function main() {
  // 1. Check shards JSONB on game_players
  console.log('=== SHARDS JSONB (game_players.rune_shards) ===\n');
  const { rows } = await pool.query(`
    SELECT gp.rune_shards, pl.name, gp.game_id
    FROM game_players gp
    JOIN players pl ON pl.id = gp.player_id
    WHERE gp.game_id IN (SELECT id FROM games WHERE match_id IN (1350541, 1402258))
    ORDER BY gp.game_id, gp.team_id, gp.role
  `);

  let nullShards = 0;
  for (const r of rows) {
    if (!r.rune_shards) {
      console.log(`  ${r.name} (game ${r.game_id}): rune_shards = NULL`);
      nullShards++;
      continue;
    }
    const s = r.rune_shards;
    const off = s.offense ? `${s.offense.name}(${s.offense.id}) img=${s.offense.image_url ? 'YES' : 'NO'}` : 'NULL';
    const flx = s.flex    ? `${s.flex.name}(${s.flex.id}) img=${s.flex.image_url ? 'YES' : 'NO'}` : 'NULL';
    const def = s.defense ? `${s.defense.name}(${s.defense.id}) img=${s.defense.image_url ? 'YES' : 'NO'}` : 'NULL';
    console.log(`  ${r.name.padEnd(15)} (game ${r.game_id}): offense=${off}  flex=${flx}  defense=${def}`);
  }
  console.log(`\nTotal: ${rows.length} players, ${nullShards} with NULL shards`);

  // 2. Check game_player_runes slots 6-8 (shard slots)
  console.log('\n=== SHARD SLOTS (game_player_runes slots 6,7,8) ===\n');
  const { rows: shardSlots } = await pool.query(`
    SELECT pl.name, gpr.slot, gpr.rune_id, r.name AS rune_name, r.image_url, gp.game_id
    FROM game_player_runes gpr
    JOIN game_players gp ON gp.id = gpr.game_player_id
    JOIN players pl ON pl.id = gp.player_id
    LEFT JOIN runes r ON r.id = gpr.rune_id
    WHERE gp.game_id IN (SELECT id FROM games WHERE match_id IN (1350541, 1402258))
      AND gpr.slot >= 6
    ORDER BY gp.game_id, gp.team_id, gpr.game_player_id, gpr.slot
  `);

  let missingImg = 0;
  let missingName = 0;
  for (const r of shardSlots) {
    const slotLabel = r.slot === 6 ? 'offense' : r.slot === 7 ? 'flex' : 'defense';
    const img = r.image_url ? 'img=YES' : 'img=NO';
    const name = r.rune_name || '???';
    if (!r.image_url) missingImg++;
    if (!r.rune_name) missingName++;
    console.log(`  ${r.name.padEnd(15)} game=${r.game_id} slot${r.slot}(${slotLabel}): ${name}(${r.rune_id}) ${img}`);
  }
  console.log(`\nTotal shard slots: ${shardSlots.length}, missing image: ${missingImg}, missing name: ${missingName}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
