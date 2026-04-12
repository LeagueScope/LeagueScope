#!/usr/bin/env node
/**
 * compare-runes.js — Compare runes data between API and DB for two matches
 *
 * For each game in both matches, shows:
 *   - API runes_reforged structure (primary_path, secondary_path, keystone, perks, shards)
 *   - DB game_players (rune_primary_path_id, rune_secondary_path_id, rune_shards)
 *   - DB game_player_runes (each slot)
 *   - DB rune_paths and runes lookups
 *   - Mismatches highlighted
 *
 * Usage: node scripts/compare-runes.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.PANDASCORE_TOKEN;
const PG_DSN = process.env.PG_DSN;
const pool = new pg.Pool({ connectionString: PG_DSN });
const BASE_URL = 'https://api.pandascore.co';

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

const GOOD_MATCH = 1350541;   // G2 vs KC
const SUSPECT_MATCH = 1402258; // VIT vs MKOI

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries({ per_page: 100, ...params })) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${url.pathname}`);
  return res.json();
}

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function analyzeMatch(matchId, label) {
  console.log(`\n${BOLD}${C}${'═'.repeat(70)}${RST}`);
  console.log(`${BOLD}${C}  MATCH ${matchId} — ${label}${RST}`);
  console.log(`${BOLD}${C}${'═'.repeat(70)}${RST}`);

  // 1. Fetch games from API
  const games = await apiGet(`/lol/matches/${matchId}/games`, { per_page: 100 });
  console.log(`  API: ${games.length} games\n`);

  // 2. Get DB rune_paths and runes for lookup
  const dbPaths = await q('SELECT id, name FROM rune_paths ORDER BY id');
  const dbRunes = await q('SELECT id, name, type::text FROM runes ORDER BY id');
  const pathMap = {};
  for (const p of dbPaths) pathMap[p.id] = p.name;
  const runeMap = {};
  for (const r of dbRunes) runeMap[r.id] = `${r.name} (${r.type})`;

  console.log(`  DB rune_paths: ${dbPaths.length} rows — ${dbPaths.slice(0, 8).map(p => `${p.id}="${p.name}"`).join(', ')}${dbPaths.length > 8 ? '...' : ''}`);
  console.log(`  DB runes: ${dbRunes.length} rows\n`);

  for (const game of games) {
    if (!game.players || game.players.length === 0) continue;

    console.log(`${BOLD}  ── Game ${game.id} (pos ${game.position}) ──${RST}`);

    // Get DB game_players for this game
    const dbPlayers = await q(`
      SELECT gp.id, gp.player_id, gp.champion_id,
             gp.rune_primary_path_id, gp.rune_secondary_path_id, gp.rune_shards,
             p.name AS player_name
      FROM game_players gp
      JOIN players p ON p.id = gp.player_id
      WHERE gp.game_id = $1
      ORDER BY gp.team_id, gp.role
    `, [game.id]);

    // Index DB players by player_id
    const dbPlayerMap = {};
    for (const dp of dbPlayers) dbPlayerMap[dp.player_id] = dp;

    for (const apiPlayer of game.players) {
      const pid = apiPlayer.player_id || apiPlayer.id;
      const name = apiPlayer.name || apiPlayer.player?.name || `Player#${pid}`;
      const dbP = dbPlayerMap[pid];

      console.log(`\n    ${BOLD}${name}${RST} (player_id=${pid})`);

      // ── API runes ──
      const rr = apiPlayer.runes_reforged || apiPlayer.runes;
      if (!rr) {
        console.log(`      ${Y}API: no runes_reforged data${RST}`);
      } else {
        const pp = rr.primary_path || {};
        const sp = rr.secondary_path || {};
        const ks = pp.keystone || {};
        const shards = rr.shards || {};

        console.log(`      ${DIM}API primary_path:${RST}   id=${pp.id}  name="${pp.name}"`);
        console.log(`      ${DIM}API secondary_path:${RST} id=${sp.id}  name="${sp.name}"`);
        console.log(`      ${DIM}API keystone:${RST}       id=${ks.id}  name="${ks.name}"`);

        const pPerks = pp.lesser_runes || pp.perks || [];
        console.log(`      ${DIM}API primary perks:${RST}  ${pPerks.map(r => `${r.name}(${r.id})`).join(', ')}`);

        const sPerks = sp.lesser_runes || sp.perks || [];
        console.log(`      ${DIM}API secondary perks:${RST} ${sPerks.map(r => `${r.name}(${r.id})`).join(', ')}`);

        const shardStr = ['offense', 'flex', 'defense'].map(k => {
          const s = shards[k];
          return s ? `${k}=${s.name}(${s.id})` : `${k}=null`;
        }).join(', ');
        console.log(`      ${DIM}API shards:${RST}         ${shardStr}`);
      }

      // ── DB game_players rune fields ──
      if (!dbP) {
        console.log(`      ${R}DB: player NOT FOUND in game_players!${RST}`);
        continue;
      }

      const dbPrimaryName = pathMap[dbP.rune_primary_path_id] || 'NOT_FOUND';
      const dbSecondaryName = pathMap[dbP.rune_secondary_path_id] || 'NOT_FOUND';
      console.log(`      ${DIM}DB  primary_path_id:${RST} ${dbP.rune_primary_path_id} → "${dbPrimaryName}"`);
      console.log(`      ${DIM}DB  secondary_path_id:${RST} ${dbP.rune_secondary_path_id} → "${dbSecondaryName}"`);

      // Check path match
      if (rr) {
        const pp = rr.primary_path || {};
        const sp = rr.secondary_path || {};
        if (dbP.rune_primary_path_id !== pp.id) {
          console.log(`      ${R}✖ PRIMARY PATH MISMATCH: DB=${dbP.rune_primary_path_id} vs API=${pp.id}${RST}`);
        }
        if (dbP.rune_secondary_path_id !== sp.id) {
          console.log(`      ${R}✖ SECONDARY PATH MISMATCH: DB=${dbP.rune_secondary_path_id} vs API=${sp.id}${RST}`);
        }
        // Check if path name resolves correctly
        if (dbPrimaryName !== pp.name && dbP.rune_primary_path_id === pp.id) {
          console.log(`      ${R}✖ PRIMARY PATH NAME WRONG: DB resolves to "${dbPrimaryName}" but API says "${pp.name}"${RST}`);
        }
        if (dbSecondaryName !== sp.name && dbP.rune_secondary_path_id === sp.id) {
          console.log(`      ${R}✖ SECONDARY PATH NAME WRONG: DB resolves to "${dbSecondaryName}" but API says "${sp.name}"${RST}`);
        }
      }

      // ── DB game_player_runes ──
      const dbRunes2 = await q(`
        SELECT gpr.rune_id, gpr.tree::text, gpr.slot, r.name AS rune_name, r.type::text AS rune_type
        FROM game_player_runes gpr
        LEFT JOIN runes r ON r.id = gpr.rune_id
        WHERE gpr.game_player_id = $1
        ORDER BY gpr.slot
      `, [dbP.id]);

      console.log(`      ${DIM}DB  game_player_runes (${dbRunes2.length} rows):${RST}`);
      for (const r of dbRunes2) {
        console.log(`        slot ${r.slot}: [${r.tree}] ${r.rune_name || '???'}(${r.rune_id}) type=${r.rune_type}`);
      }

      // Compare individual runes
      if (rr) {
        const pp = rr.primary_path || {};
        const sp = rr.secondary_path || {};
        const ks = pp.keystone || {};
        const pPerks = pp.lesser_runes || pp.perks || [];
        const sPerks = sp.lesser_runes || sp.perks || [];
        const shards = rr.shards || {};

        // Build expected rune list from API
        const expected = [];
        if (ks.id) expected.push({ slot: 0, tree: 'primary', id: ks.id, name: ks.name, label: 'keystone' });
        pPerks.forEach((r, i) => { if (r.id) expected.push({ slot: i + 1, tree: 'primary', id: r.id, name: r.name, label: `primary_perk_${i}` }); });
        sPerks.forEach((r, i) => { if (r.id) expected.push({ slot: i + 4, tree: 'secondary', id: r.id, name: r.name, label: `secondary_perk_${i}` }); });
        if (shards.offense?.id) expected.push({ slot: 6, tree: 'primary', id: shards.offense.id, name: shards.offense.name, label: 'shard_offense' });
        if (shards.flex?.id) expected.push({ slot: 7, tree: 'primary', id: shards.flex.id, name: shards.flex.name, label: 'shard_flex' });
        if (shards.defense?.id) expected.push({ slot: 8, tree: 'primary', id: shards.defense.id, name: shards.defense.name, label: 'shard_defense' });

        // Compare
        const dbRuneMap = {};
        for (const r of dbRunes2) dbRuneMap[r.slot] = r;

        let mismatches = 0;
        for (const exp of expected) {
          const db = dbRuneMap[exp.slot];
          if (!db) {
            console.log(`      ${R}✖ MISSING slot ${exp.slot} (${exp.label}): expected ${exp.name}(${exp.id})${RST}`);
            mismatches++;
          } else if (db.rune_id !== exp.id) {
            console.log(`      ${R}✖ SLOT ${exp.slot} MISMATCH (${exp.label}): DB=${db.rune_name}(${db.rune_id}) vs API=${exp.name}(${exp.id})${RST}`);
            mismatches++;
          }
        }

        // Check for extra DB runes not in API
        for (const r of dbRunes2) {
          const exp = expected.find(e => e.slot === r.slot);
          if (!exp) {
            console.log(`      ${Y}⚠ EXTRA DB rune at slot ${r.slot}: ${r.rune_name}(${r.rune_id}) — not in API${RST}`);
            mismatches++;
          }
        }

        if (mismatches === 0) {
          console.log(`      ${G}✔ All ${expected.length} runes match API${RST}`);
        } else {
          console.log(`      ${R}✖ ${mismatches} rune mismatches${RST}`);
        }
      }

      // ── DB rune_shards JSONB ──
      if (dbP.rune_shards) {
        const shards = typeof dbP.rune_shards === 'string' ? JSON.parse(dbP.rune_shards) : dbP.rune_shards;
        const shardStr = ['offense', 'flex', 'defense'].map(k => {
          const s = shards[k];
          return s ? `${k}=${s.name}(${s.id})` : `${k}=null`;
        }).join(', ');
        console.log(`      ${DIM}DB  rune_shards JSONB:${RST} ${shardStr}`);

        // Compare shards
        if (rr?.shards) {
          let shardMismatch = false;
          for (const k of ['offense', 'flex', 'defense']) {
            const apiS = rr.shards[k];
            const dbS = shards[k];
            if (apiS?.id && dbS?.id && apiS.id !== dbS.id) {
              console.log(`      ${R}✖ SHARD ${k} MISMATCH: DB=${dbS.name}(${dbS.id}) vs API=${apiS.name}(${apiS.id})${RST}`);
              shardMismatch = true;
            } else if (apiS?.id && !dbS?.id) {
              console.log(`      ${R}✖ SHARD ${k} MISSING in DB: API=${apiS.name}(${apiS.id})${RST}`);
              shardMismatch = true;
            }
          }
          if (!shardMismatch) {
            console.log(`      ${G}✔ Shards match API${RST}`);
          }
        }
      } else {
        console.log(`      ${Y}⚠ DB rune_shards: NULL${RST}`);
      }
    }
  }
}

async function main() {
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}  RUNE COMPARISON: API vs DB${RST}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════════${RST}`);

  await analyzeMatch(GOOD_MATCH, 'G2 vs KC (GOOD)');
  await analyzeMatch(SUSPECT_MATCH, 'VIT vs MKOI (SUSPECT)');

  // Summary
  console.log(`\n${BOLD}${C}${'═'.repeat(70)}${RST}`);
  console.log(`${BOLD}${C}  RUNE_PATHS TABLE STATE${RST}`);
  console.log(`${BOLD}${C}${'═'.repeat(70)}${RST}`);

  const paths = await q('SELECT id, name FROM rune_paths ORDER BY id');
  console.log(`  Total: ${paths.length} rows (expected: 5)`);
  for (const p of paths) {
    console.log(`    id=${p.id}  name="${p.name}"`);
  }

  if (paths.length > 5) {
    console.log(`\n  ${R}${BOLD}⚠ rune_paths IS POLLUTED! Has ${paths.length} rows instead of 5.${RST}`);
    console.log(`  ${R}Run: node scripts/fetch-to-postgres.js --static-only${RST}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
