import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_TOKEN = process.env.PANDASCORE_TOKEN;
const SERIE_ID = process.argv[2] || '10355';
// Need a player_id from this serie - get from DB or use a known one
const PLAYER_ID = process.argv[3] || '605'; // from the player_career query
const OUT_FILE = join(__dirname, '..', 'debug-player-output.txt');

async function main() {
  console.log('API_TOKEN present:', !!API_TOKEN);

  let out = '';

  // Fetch player stats for a specific player in a serie
  const url = `https://api.pandascore.co/lol/series/${SERIE_ID}/players/${PLAYER_ID}/stats`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
  console.log('HTTP Status:', res.status);

  if (!res.ok) { console.log(await res.text()); return; }

  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : data;

  out += `=== FULL RESPONSE ===\n`;
  out += JSON.stringify(first, null, 2) + '\n';

  out += `\n=== TOP-LEVEL KEYS ===\n`;
  out += JSON.stringify(Object.keys(first)) + '\n';

  // Check player info
  out += `\n=== PLAYER INFO ===\n`;
  out += `first.player?.id: ${first.player?.id}\n`;
  out += `first.player?.name: ${first.player?.name}\n`;
  out += `first.team?.id: ${first.team?.id}\n`;

  if (first.stats) {
    out += `\n=== stats KEYS ===\n`;
    out += JSON.stringify(Object.keys(first.stats)) + '\n';

    for (const k of ['totals', 'total', 'averages', 'average']) {
      if (first.stats[k]) {
        out += `\n=== stats.${k} KEYS ===\n`;
        out += JSON.stringify(Object.keys(first.stats[k])) + '\n';
        out += `=== stats.${k} VALUES ===\n`;
        out += JSON.stringify(first.stats[k], null, 2) + '\n';
      }
    }

    const s = first.stats;
    out += `\n=== stats DIRECT FIELDS ===\n`;
    out += JSON.stringify({
      games_count: s.games_count, wins: s.wins, losses: s.losses,
      win_rate: s.win_rate, kda: s.kda, kill_participation: s.kill_participation,
      unique_champions: s.unique_champions, blue_games: s.blue_games,
      blue_wins: s.blue_wins, red_games: s.red_games, red_wins: s.red_wins,
      max_kills: s.max_kills, first_blood_percentage: s.first_blood_percentage,
      first_tower_percentage: s.first_tower_percentage
    }, null, 2) + '\n';
  }

  writeFileSync(OUT_FILE, out, 'utf-8');
  console.log(`\nSaved to: ${OUT_FILE}`);
}

main().catch(e => console.error('ERROR:', e.message));
