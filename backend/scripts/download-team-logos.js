#!/usr/bin/env node
/**
 * download-team-logos.js
 *
 * Descarga los logos de los equipos de las 22 ligas activas desde el CDN de
 * PandaScore y los guarda organizados por liga -> equipo, pensados para
 * plantillas de redes.
 *
 * NO toca Postgres. Solo llama a la API publica de PandaScore para saber
 * que equipos juegan el torneo mas reciente de cada liga, y que URL tiene
 * su logo (claro y oscuro).
 *
 * Estructura de salida:
 *   <OUT_DIR>/
 *     lec/
 *       g2/       light.png   dark.png
 *       kc/       light.png   dark.png
 *     lck/
 *       t1/       light.png   dark.png
 *       geng/     ...
 *     _manifest.json
 *
 * Uso (desde la raiz del repo):
 *   PANDASCORE_TOKEN=xxx node backend/scripts/download-team-logos.js
 *   PANDASCORE_TOKEN=xxx node backend/scripts/download-team-logos.js --out ./plantillas-redes/logos --force
 *
 * Flags:
 *   --out <dir>         Carpeta destino (default: ./team-logos en la raiz del repo)
 *   --force             Sobreescribe ficheros existentes
 *   --only <slug,slug>  Filtra a estas ligas (ej: lec,lck,lpl)
 *   --light-only        Solo descarga el logo claro (image_url)
 *   --dark-only         Solo descarga el logo oscuro (dark_mode_image_url)
 *   --dry-run           Lista lo que haria sin descargar nada
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga backend/.env sin importar desde donde se lance el script.
// Orden de busqueda: backend/.env -> <repo-root>/.env
const ENV_CANDIDATES = [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];
for (const p of ENV_CANDIDATES) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const TOKEN = process.env.PANDASCORE_TOKEN;
if (!TOKEN) {
  console.error('[download-team-logos] ERROR: falta PANDASCORE_TOKEN.');
  console.error('  Revisa backend/.env o pasalo como variable de entorno.');
  process.exit(1);
}

const LEAGUES = {
  lec:           { id: 4197, name: 'LEC' },
  lck:           { id: 293,  name: 'LCK' },
  lpl:           { id: 294,  name: 'LPL' },
  lcs:           { id: 4198, name: 'LCS' },
  cblol:         { id: 302,  name: 'CBLOL' },
  lcp:           { id: 5351, name: 'LCP' },
  vcs:           { id: 4141, name: 'VCS' },
  ljl:           { id: 2092, name: 'LJL' },
  tcl:           { id: 1003, name: 'TCL' },
  lck_cl:        { id: 4553, name: 'LCK Challengers' },
  na_cl:         { id: 4961, name: 'NACL' },
  emea_masters:  { id: 4996, name: 'EMEA Masters' },
  circuito_des:  { id: 5377, name: 'Circuito Desafiante' },
  lrn:           { id: 5048, name: 'LRN' },
  lrs:           { id: 5049, name: 'LRS' },
  lfl:           { id: 4292, name: 'LFL' },
  prm:           { id: 4302, name: 'Prime League' },
  les:           { id: 5496, name: 'LES' },
  nlc:           { id: 4411, name: 'NLC' },
  lit:           { id: 5211, name: 'LIT' },
  ebl:           { id: 4426, name: 'EBL' },
  road_legends:  { id: 5366, name: 'Road of Legends' },
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(value('out', path.join(REPO_ROOT, 'team-logos')));
const FORCE = flag('force');
const LIGHT_ONLY = flag('light-only');
const DARK_ONLY = flag('dark-only');
const DRY_RUN = flag('dry-run');
const ONLY = (value('only', '') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const API_BASE = 'https://api.pandascore.co';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(pth, params = {}) {
  const u = new URL(API_BASE + pth);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function apiGet(pth, params = {}) {
  const url = buildUrl(pth, params);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'User-Agent': 'LeagueScope/logo-downloader 1.0',
    },
  });
  if (res.status === 429) {
    await sleep(1500);
    return apiGet(pth, params);
  }
  if (!res.ok) throw new Error(`PandaScore ${res.status} ${res.statusText} @ ${url}`);
  return res.json();
}

function slugifyTeam(team) {
  const raw = team.acronym || team.slug || team.name || `team-${team.id}`;
  return (
    String(raw)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `team-${team.id}`
  );
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) return ext;
    return '.png';
  } catch {
    return '.png';
  }
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'LeagueScope/logo-downloader 1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const tmp = dest + '.part';
  await pipeline(res.body, fs.createWriteStream(tmp));
  await fs.promises.rename(tmp, dest);
  const stat = await fs.promises.stat(dest);
  return stat.size;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Ultima serie (split) de una liga. Los equipos cuelgan de la serie en
// PandaScore: /lol/series?filter[league_id]=X -> /lol/series/<id>/teams
async function latestSerieForLeague(leagueId) {
  const series = await apiGet('/lol/series', {
    'filter[league_id]': leagueId,
    sort: '-year,-begin_at',
    per_page: 5,
  });
  if (!Array.isArray(series) || series.length === 0) return null;
  const now = Date.now();
  const started = series.filter(
    (s) => s.begin_at && new Date(s.begin_at).getTime() <= now,
  );
  return started[0] || series[0] || null;
}

async function teamsForSerie(serieId) {
  const data = await apiGet(`/lol/series/${serieId}/teams`, { per_page: 100 });
  if (!Array.isArray(data)) return [];
  return data.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    acronym: t.acronym,
    image_url: t.image_url,
    dark_mode_image_url: t.dark_mode_image_url,
  }));
}

async function main() {
  const selected = Object.entries(LEAGUES).filter(
    ([slug]) => ONLY.length === 0 || ONLY.includes(slug),
  );
  if (selected.length === 0) {
    console.error('[download-team-logos] No hay ligas seleccionadas (revisa --only).');
    process.exit(1);
  }

  console.log(`[download-team-logos] Ligas: ${selected.map(([s]) => s).join(', ')}`);
  console.log(`[download-team-logos] OUT_DIR: ${OUT_DIR}`);
  console.log(`[download-team-logos] Modo: ${DRY_RUN ? 'DRY RUN' : 'DOWNLOAD'}${FORCE ? ' (force)' : ''}`);

  const manifest = { generated_at: new Date().toISOString(), leagues: {} };
  let total = 0, ok = 0, skipped = 0, failed = 0, missingUrl = 0, emptyLeagues = 0;

  for (const [slug, info] of selected) {
    console.log(`\n== ${slug.toUpperCase()} (${info.name}, id=${info.id}) ==`);

    let serie;
    try {
      serie = await latestSerieForLeague(info.id);
    } catch (err) {
      console.warn(`  ! no pude listar series: ${err.message}`);
      emptyLeagues++;
      manifest.leagues[slug] = { id: info.id, name: info.name, error: String(err.message) };
      continue;
    }
    if (!serie) {
      console.warn('  ! no hay series en PandaScore todavia');
      emptyLeagues++;
      manifest.leagues[slug] = { id: info.id, name: info.name, series: 0 };
      continue;
    }

    let teams;
    try {
      teams = await teamsForSerie(serie.id);
    } catch (err) {
      console.warn(`  ! no pude listar equipos de la serie ${serie.id}: ${err.message}`);
      emptyLeagues++;
      manifest.leagues[slug] = {
        id: info.id, name: info.name, serie_id: serie.id, error: String(err.message),
      };
      continue;
    }
    const serieLabel = serie.full_name || serie.name || serie.slug || serie.id;
    console.log(
      `  - Serie: ${serieLabel} (${serie.begin_at || 's/f'}) - ${teams.length} equipos`,
    );

    const leagueDir = path.join(OUT_DIR, slug);
    if (!DRY_RUN) ensureDir(leagueDir);

    manifest.leagues[slug] = {
      id: info.id, name: info.name,
      serie: {
        id: serie.id,
        full_name: serie.full_name,
        name: serie.name,
        slug: serie.slug,
        year: serie.year,
        season: serie.season,
        begin_at: serie.begin_at,
      },
      teams: [],
    };

    for (const t of teams) {
      const teamSlug = slugifyTeam(t);
      const teamDir = path.join(leagueDir, teamSlug);
      if (!DRY_RUN) ensureDir(teamDir);

      const targets = [];
      if (DARK_ONLY) {
        // Dark preferido, con fallback al logo normal (que en PandaScore suele
        // estar ya pensado para fondos oscuros cuando no hay dark_mode_image_url).
        const darkUrl = t.dark_mode_image_url || t.image_url;
        if (darkUrl) targets.push({ kind: 'dark', url: darkUrl });
      } else if (LIGHT_ONLY) {
        if (t.image_url) targets.push({ kind: 'light', url: t.image_url });
      } else {
        if (t.image_url) targets.push({ kind: 'light', url: t.image_url });
        if (t.dark_mode_image_url) targets.push({ kind: 'dark', url: t.dark_mode_image_url });
      }

      const teamReport = { id: t.id, name: t.name, acronym: t.acronym, slug_used: teamSlug, files: [] };

      if (targets.length === 0) {
        missingUrl++;
        console.log(`  - ${teamSlug.padEnd(20)} - (sin URLs)`);
        teamReport.files.push({ kind: 'none', status: 'missing-url' });
        manifest.leagues[slug].teams.push(teamReport);
        continue;
      }

      for (const { kind, url } of targets) {
        total++;
        const ext = extFromUrl(url);
        const dest = path.join(teamDir, `${kind}${ext}`);
        const rel = path.relative(OUT_DIR, dest);

        if (!FORCE && fs.existsSync(dest)) {
          skipped++;
          teamReport.files.push({ kind, status: 'skipped', path: rel, url });
          console.log(`  - ${teamSlug.padEnd(20)} ${kind.padEnd(5)} - skip (existe)`);
          continue;
        }
        if (DRY_RUN) {
          teamReport.files.push({ kind, status: 'dry-run', path: rel, url });
          console.log(`  - ${teamSlug.padEnd(20)} ${kind.padEnd(5)} - would get ${url}`);
          continue;
        }
        try {
          const bytes = await downloadFile(url, dest);
          ok++;
          teamReport.files.push({ kind, status: 'ok', path: rel, bytes });
          console.log(`  - ${teamSlug.padEnd(20)} ${kind.padEnd(5)} - ${bytes} B`);
        } catch (err) {
          failed++;
          teamReport.files.push({ kind, status: 'error', error: String(err.message || err), url });
          console.warn(`  - ${teamSlug.padEnd(20)} ${kind.padEnd(5)} - FAIL ${err.message || err}`);
        }
      }

      manifest.leagues[slug].teams.push(teamReport);
    }
  }

  if (!DRY_RUN) {
    ensureDir(OUT_DIR);
    fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
  }

  console.log('\n=== Resumen ===');
  console.log(`  Ligas procesadas : ${selected.length - emptyLeagues}/${selected.length}`);
  console.log(`  Targets totales  : ${total}`);
  console.log(`  Descargados      : ${ok}`);
  console.log(`  Saltados         : ${skipped}`);
  console.log(`  Sin URL          : ${missingUrl}`);
  console.log(`  Errores          : ${failed}`);
  if (!DRY_RUN) console.log(`  Manifest         : ${path.join(OUT_DIR, '_manifest.json')}`);
}

main().catch((err) => {
  console.error('[download-team-logos] FATAL:', err);
  process.exit(1);
});
