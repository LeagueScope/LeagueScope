#!/usr/bin/env node
/**
 * debug-runes-api.js — Dump the PandaScore /lol/runes-reforged API response
 * to understand the structure and fix rune_paths ingestion.
 *
 * Also queries DB to show current rune_paths state vs what it should be.
 */

import axios from 'axios';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.PANDASCORE_TOKEN;
const PG_DSN = process.env.PG_DSN;
const pool = new pg.Pool({ connectionString: PG_DSN });

async function main() {
  // 1. Fetch API data
  console.log('=== FETCHING /lol/runes-reforged ===\n');
  const { data } = await axios.get('https://api.pandascore.co/lol/runes-reforged', {
    headers: { Authorization: `Bearer ${TOKEN}` },
    params: { per_page: 100 },
  });

  console.log(`API returned ${data.length} top-level items\n`);

  for (const item of data.slice(0, 10)) {
    console.log(`--- Item id=${item.id}, name="${item.name}" ---`);
    console.log(`  Keys: ${Object.keys(item).join(', ')}`);
    if (item.slots) {
      console.log(`  Has "slots" array with ${item.slots.length} entries`);
      for (let si = 0; si < item.slots.length; si++) {
        const slot = item.slots[si];
        const runeNames = (slot.runes || []).map(r => `${r.name}(${r.id})`).join(', ');
        console.log(`    slot[${si}]: ${(slot.runes || []).length} runes — ${runeNames}`);
      }
    } else {
      console.log(`  NO "slots" key — this is a FLAT rune, not a path!`);
      console.log(`  Full object: ${JSON.stringify(item).substring(0, 200)}`);
    }
    console.log('');
  }

  if (data.length > 10) {
    console.log(`... and ${data.length - 10} more items\n`);
    // Show a sample of the remaining
    for (const item of data.slice(10, 15)) {
      console.log(`  id=${item.id}, name="${item.name}", has_slots=${!!item.slots}`);
    }
  }

  // 2. Check current DB state
  console.log('\n=== CURRENT DB STATE ===\n');

  const { rows: paths } = await pool.query('SELECT * FROM rune_paths ORDER BY id LIMIT 20');
  console.log(`rune_paths: ${paths.length} rows (first 20):`);
  for (const p of paths) {
    console.log(`  id=${p.id}  name="${p.name}"  image=${p.image_url ? 'yes' : 'no'}`);
  }

  const { rows: runesSample } = await pool.query('SELECT id, name, type::text FROM runes ORDER BY id LIMIT 20');
  console.log(`\nrunes: sample (first 20):`);
  for (const r of runesSample) {
    console.log(`  id=${r.id}  name="${r.name}"  type=${r.type}`);
  }

  // 3. Check if rune_paths IDs overlap with runes IDs
  const { rows: overlap } = await pool.query(`
    SELECT rp.id, rp.name AS path_name, r.name AS rune_name
    FROM rune_paths rp
    JOIN runes r ON r.id = rp.id
    LIMIT 20
  `);
  if (overlap.length > 0) {
    console.log(`\n⚠ OVERLAP: ${overlap.length} IDs exist in BOTH rune_paths and runes:`);
    for (const o of overlap) {
      console.log(`  id=${o.id}: rune_paths="${o.path_name}", runes="${o.rune_name}"`);
    }
  }

  // 4. Check what game_players reference as rune paths
  const { rows: usedPaths } = await pool.query(`
    SELECT DISTINCT gp.rune_primary_path_id AS pid, rp.name AS path_name
    FROM game_players gp
    LEFT JOIN rune_paths rp ON rp.id = gp.rune_primary_path_id
    WHERE gp.rune_primary_path_id IS NOT NULL
    ORDER BY pid
    LIMIT 20
  `);
  console.log(`\nDistinct rune_primary_path_ids used by game_players:`);
  for (const u of usedPaths) {
    console.log(`  id=${u.pid}  resolves_to="${u.path_name}"`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
