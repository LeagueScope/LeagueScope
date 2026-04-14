#!/usr/bin/env node
/**
 * find-international-league-ids.js
 *
 * Busca en PandaScore los IDs de los torneos internacionales de LoL
 * que actualmente NO están en match-poller.js ni fetch-to-postgres.js:
 *   - Worlds (World Championship)
 *   - MSI (Mid-Season Invitational)
 *   - First Stand
 *   - Esports World Cup (EWC)
 *
 * Uso:
 *   node scripts/find-international-league-ids.js
 *
 * Requiere PANDASCORE_TOKEN en el entorno (ya cargado por dotenv si hay .env).
 */

import 'dotenv/config';

const TOKEN = process.env.PANDASCORE_TOKEN;
if (!TOKEN) {
  console.error('ERROR: PANDASCORE_TOKEN no está definido en el entorno.');
  process.exit(1);
}

const SEARCHES = [
  { label: 'Worlds',             query: 'worlds' },
  { label: 'World Championship', query: 'world championship' },
  { label: 'MSI',                query: 'msi' },
  { label: 'Mid-Season',         query: 'mid-season' },
  { label: 'First Stand',        query: 'first stand' },
  { label: 'Esports World Cup',  query: 'esports world cup' },
  { label: 'EWC',                query: 'ewc' },
];

const BASE = 'https://api.pandascore.co/lol/leagues';

async function searchLeagues(query) {
  const url = `${BASE}?search[name]=${encodeURIComponent(query)}&per_page=50`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} para "${query}"`);
  }
  return res.json();
}

async function fetchTournamentsForLeague(leagueId) {
  const url = `${BASE}/${leagueId}/tournaments?per_page=5&sort=-begin_at`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [];
  return res.json();
}

function fmt(league) {
  return {
    id: league.id,
    name: league.name,
    slug: league.slug,
    url: league.url,
  };
}

async function main() {
  console.log('Buscando ligas internacionales en PandaScore...\n');

  const seen = new Map(); // id → league

  for (const { label, query } of SEARCHES) {
    try {
      const results = await searchLeagues(query);
      if (results.length === 0) {
        console.log(`  [${label}] sin resultados para "${query}"`);
        continue;
      }
      for (const lg of results) {
        if (!seen.has(lg.id)) seen.set(lg.id, lg);
      }
    } catch (err) {
      console.error(`  [${label}] error: ${err.message}`);
    }
  }

  if (seen.size === 0) {
    console.log('\nNo se encontró ninguna liga. ¿Token válido?');
    return;
  }

  console.log(`\nCoincidencias únicas: ${seen.size}\n`);
  console.log('─'.repeat(80));

  // Enrich with last tournament (to see if it's active this year)
  const leagues = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));

  for (const lg of leagues) {
    const tournaments = await fetchTournamentsForLeague(lg.id);
    const latest = tournaments[0];
    const when = latest?.begin_at ? latest.begin_at.slice(0, 10) : '—';
    const tname = latest?.name || '—';

    console.log(`ID: ${lg.id}  |  ${lg.name}`);
    console.log(`    slug:         ${lg.slug}`);
    console.log(`    último torneo: ${tname} (${when})`);
    console.log('');
  }

  console.log('─'.repeat(80));
  console.log('\nSiguiente paso: identifica los IDs que correspondan y añádelos a');
  console.log('  backend/scripts/match-poller.js');
  console.log('  backend/scripts/fetch-to-postgres.js');
  console.log('en la constante LEAGUE_IDS bajo una nueva sección "// International".');
}

main().catch((err) => {
  console.error('Fallo:', err);
  process.exit(1);
});
