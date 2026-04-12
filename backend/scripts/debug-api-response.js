#!/usr/bin/env node
/**
 * debug-api-response.js — Dump raw PandaScore API response for a game's events and frames.
 * Usage: node scripts/debug-api-response.js --game-id <GAME_ID>
 *   or:  node scripts/debug-api-response.js --match-id <MATCH_ID>  (uses first game)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env loader
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) { const k = t.slice(0, eq).trim(); if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim(); }
  }
}

const TOKEN = process.env.PANDASCORE_TOKEN;
if (!TOKEN) { console.error('PANDASCORE_TOKEN not set'); process.exit(1); }

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function apiGet(path) {
  const url = `https://api.pandascore.co${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) { console.error(`HTTP ${res.status} for ${path}`); return null; }
  return res.json();
}

async function main() {
  let gameId = getArg('game-id') ? Number(getArg('game-id')) : null;
  const matchId = getArg('match-id') ? Number(getArg('match-id')) : null;

  // GOOD match game for reference
  const goodGameId = 275077; // G2 vs KC Game 1

  if (!gameId && matchId) {
    console.log(`Fetching games for match ${matchId}...`);
    const games = await apiGet(`/lol/matches/${matchId}/games`);
    if (!games || !games.length) { console.error('No games found'); process.exit(1); }
    gameId = games[0].id;
    console.log(`Using first game: ${gameId}\n`);

    // FULL game object dump (first 2000 chars)
    console.log('=== FULL GAME OBJECT (SUSPECT - first game) ===');
    console.log(JSON.stringify(games[0], null, 2).slice(0, 2500));
    console.log('...\n');
  }

  // Also fetch the GOOD game directly via /lol/games/{id}
  console.log('=== FULL GAME OBJECT (GOOD - G2 vs KC Game 1, id 275077) ===');
  const goodGame = await apiGet(`/lol/games/275077`);
  if (goodGame) {
    console.log(JSON.stringify(goodGame, null, 2).slice(0, 2500));
    console.log('...\n');
  } else {
    // Try via match endpoint
    console.log('Direct game fetch returned null, trying via match...');
    const goodGames = await apiGet(`/lol/matches/1350541/games`);
    if (goodGames && goodGames.length) {
      console.log(JSON.stringify(goodGames[0], null, 2).slice(0, 2500));
      console.log('...\n');
    }
  }

  if (!gameId) { console.error('Provide --game-id or --match-id'); process.exit(1); }

  // ─── EVENTS ───
  console.log(`=== EVENTS for game ${gameId} (SUSPECT) ===`);
  const events = await apiGet(`/lol/games/${gameId}/events`);
  if (!events) {
    console.log('  No events returned (null)');
  } else if (!Array.isArray(events)) {
    console.log(`  NOT an array! Type: ${typeof events}`);
    console.log(`  Keys: ${Object.keys(events).join(', ')}`);
    console.log(`  First 500 chars: ${JSON.stringify(events).slice(0, 500)}`);
  } else {
    console.log(`  Total events: ${events.length}`);
    // Show first 3 events in full
    for (let i = 0; i < Math.min(3, events.length); i++) {
      console.log(`\n  Event ${i}:`);
      console.log(`    ${JSON.stringify(events[i], null, 2).split('\n').join('\n    ')}`);
    }
    // Type breakdown
    const types = {};
    for (const ev of events) { types[ev.type] = (types[ev.type] || 0) + 1; }
    console.log(`\n  Type breakdown: ${JSON.stringify(types)}`);
    // Check which events have timestamps
    const withTs = events.filter(e => e.timestamp != null).length;
    const withKiller = events.filter(e => e.killer?.player_id != null).length;
    const withVictim = events.filter(e => e.victim?.player_id != null).length;
    console.log(`  With timestamp: ${withTs}/${events.length}`);
    console.log(`  With killer.player_id: ${withKiller}/${events.length}`);
    console.log(`  With victim.player_id: ${withVictim}/${events.length}`);
  }

  // Also fetch GOOD match events for comparison
  console.log(`\n=== EVENTS for game ${goodGameId} (GOOD / G2 vs KC Game 1) ===`);
  const goodEvents = await apiGet(`/lol/games/${goodGameId}/events`);
  if (goodEvents && Array.isArray(goodEvents)) {
    console.log(`  Total events: ${goodEvents.length}`);
    for (let i = 0; i < Math.min(3, goodEvents.length); i++) {
      console.log(`\n  Event ${i}:`);
      console.log(`    ${JSON.stringify(goodEvents[i], null, 2).split('\n').join('\n    ')}`);
    }
    const types = {};
    for (const ev of goodEvents) { types[ev.type] = (types[ev.type] || 0) + 1; }
    console.log(`\n  Type breakdown: ${JSON.stringify(types)}`);
    const withTs = goodEvents.filter(e => e.timestamp != null).length;
    const withKiller = goodEvents.filter(e => e.killer?.player_id != null).length;
    const withVictim = goodEvents.filter(e => e.victim?.player_id != null).length;
    console.log(`  With timestamp: ${withTs}/${goodEvents.length}`);
    console.log(`  With killer.player_id: ${withKiller}/${goodEvents.length}`);
    console.log(`  With victim.player_id: ${withVictim}/${goodEvents.length}`);
  }

  // ─── FRAMES ───
  console.log(`\n=== FRAMES for game ${gameId} (SUSPECT) ===`);
  const frames = await apiGet(`/lol/games/${gameId}/frames`);
  if (!frames) {
    console.log('  No frames returned (null)');
  } else if (!Array.isArray(frames)) {
    console.log(`  NOT an array! Type: ${typeof frames}`);
    console.log(`  Keys: ${Object.keys(frames).join(', ')}`);
    console.log(`  First 500 chars: ${JSON.stringify(frames).slice(0, 500)}`);
  } else {
    console.log(`  Total frames: ${frames.length}`);
    // Show a mid-game frame
    const midFrame = frames[Math.floor(frames.length / 2)];
    if (midFrame) {
      console.log(`\n  Mid-game frame (index ${Math.floor(frames.length / 2)}):`);
      console.log(`    Top-level keys: ${Object.keys(midFrame).join(', ')}`);
      console.log(`    timestamp: ${midFrame.timestamp}, current_timestamp: ${midFrame.current_timestamp}`);
      if (midFrame.blue) {
        console.log(`    blue keys: ${Object.keys(midFrame.blue).join(', ')}`);
        // Check if roles exist
        for (const role of ['top', 'jun', 'mid', 'adc', 'sup']) {
          const rp = midFrame.blue[role];
          if (rp) {
            console.log(`    blue.${role}: player_id=${rp.player_id}, champion=${rp.champion?.id}, kills=${rp.kills}`);
          } else {
            console.log(`    blue.${role}: NOT PRESENT`);
          }
        }
        // Check for alternative player data structures
        if (midFrame.blue.players) {
          console.log(`    blue.players KEYS: ${Object.keys(midFrame.blue.players).join(', ')}`);
          // Show first player detail
          const firstRole = Object.keys(midFrame.blue.players)[0];
          const fp = midFrame.blue.players[firstRole];
          console.log(`    blue.players.${firstRole}: id=${fp?.id}, player_id=${fp?.player_id}, name=${fp?.name}, level=${fp?.level}, cs=${fp?.cs}`);
        }
      }
    }
  }

  // GOOD match frames for comparison
  console.log(`\n=== FRAMES for game ${goodGameId} (GOOD) ===`);
  const goodFrames = await apiGet(`/lol/games/${goodGameId}/frames`);
  if (goodFrames && Array.isArray(goodFrames)) {
    console.log(`  Total frames: ${goodFrames.length}`);
    const midFrame = goodFrames[Math.floor(goodFrames.length / 2)];
    if (midFrame) {
      console.log(`\n  Mid-game frame (index ${Math.floor(goodFrames.length / 2)}):`);
      console.log(`    Top-level keys: ${Object.keys(midFrame).join(', ')}`);
      console.log(`    timestamp: ${midFrame.timestamp}, current_timestamp: ${midFrame.current_timestamp}`);
      if (midFrame.blue) {
        console.log(`    blue keys: ${Object.keys(midFrame.blue).join(', ')}`);
        for (const role of ['top', 'jun', 'mid', 'adc', 'sup']) {
          const rp = midFrame.blue[role];
          if (rp) {
            console.log(`    blue.${role}: player_id=${rp.player_id}, champion=${rp.champion?.id}, kills=${rp.kills}`);
          } else {
            console.log(`    blue.${role}: NOT PRESENT`);
          }
        }
        if (midFrame.blue.players) {
          console.log(`    blue.players: ${JSON.stringify(midFrame.blue.players).slice(0, 300)}`);
        }
      }
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
