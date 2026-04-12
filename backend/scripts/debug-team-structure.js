import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_TOKEN = process.env.PANDASCORE_TOKEN;
const SERIE_ID = process.argv[2] || '10067';
const OUT_FILE = join(__dirname, '..', 'debug-team-output.txt');

async function main() {
  console.log('API_TOKEN present:', !!API_TOKEN);
  const url = `https://api.pandascore.co/lol/series/${SERIE_ID}/teams/stats?per_page=5`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
  console.log('HTTP Status:', res.status);

  if (!res.ok) { console.log(await res.text()); return; }

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    console.log('Empty:', JSON.stringify(data));
    return;
  }

  let out = '';
  out += `=== FULL FIRST ENTRY ===\n`;
  out += JSON.stringify(data[0], null, 2) + '\n';
  out += `\n=== TOP-LEVEL KEYS === ${JSON.stringify(Object.keys(data[0]))}\n`;
  out += `\nfirst.id: ${data[0].id}\n`;
  out += `first.team?.id: ${data[0].team?.id}\n`;
  out += `first.name: ${data[0].name}\n`;
  out += `first.team?.name: ${data[0].team?.name}\n`;

  if (data[0].stats) {
    const s = data[0].stats;
    out += `\n=== stats KEYS === ${JSON.stringify(Object.keys(s))}\n`;
    for (const k of ['totals', 'total', 'averages', 'average']) {
      if (s[k]) {
        out += `\n=== stats.${k} KEYS === ${JSON.stringify(Object.keys(s[k]))}\n`;
        out += JSON.stringify(s[k], null, 2) + '\n';
      }
    }
    out += `\n=== stats direct === ${JSON.stringify({ games_count: s.games_count, wins: s.wins, losses: s.losses, win_rate: s.win_rate })}\n`;
  }

  out += `\n=== Total: ${data.length} entries ===\n`;
  out += `IDs: ${JSON.stringify(data.map(d => d.id || d.team?.id))}\n`;
  out += `Names: ${JSON.stringify(data.map(d => d.name || d.team?.name))}\n`;

  writeFileSync(OUT_FILE, out, 'utf-8');
  console.log(`\nSaved to: ${OUT_FILE}`);
}

main().catch(e => console.error('ERROR:', e.message));
