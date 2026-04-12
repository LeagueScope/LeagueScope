import 'dotenv/config';
import pg from 'pg';

const PG_DSN = process.env.PG_DSN;
const TOKEN = process.env.PANDASCORE_TOKEN || process.env.PANDA_TOKEN;
const SERIE_ID = 10355; // LEC Spring 2026

const pool = new pg.Pool({ connectionString: PG_DSN, max: 1 });

async function run() {
  // 1. Fetch team stats from API
  const url = `https://api.pandascore.co/lol/series/${SERIE_ID}/teams/stats?per_page=100&token=${TOKEN}`;
  console.log(`Fetching: ${url.replace(TOKEN, '***')}`);
  const res = await fetch(url);
  const data = await res.json();

  if (!Array.isArray(data)) {
    console.log('Response is not an array:', typeof data, JSON.stringify(data).slice(0, 200));
    process.exit(1);
  }

  console.log(`Got ${data.length} entries\n`);

  // 2. Inspect first entry structure
  const first = data[0];
  console.log('=== TOP-LEVEL KEYS ===');
  console.log(Object.keys(first).join(', '));

  console.log('\n=== first.team ===');
  console.log(first.team ? `id=${first.team.id}, name=${first.team.name}` : 'NO .team FIELD');

  console.log('\n=== first.stats ===');
  if (first.stats) {
    console.log('Keys:', Object.keys(first.stats).join(', '));
    console.log('games_count:', first.stats.games_count);
    console.log('wins:', first.stats.wins);
    console.log('kda:', first.stats.kda);
    if (first.stats.average) {
      console.log('stats.average keys:', Object.keys(first.stats.average).join(', '));
    } else if (first.stats.averages) {
      console.log('stats.averages keys:', Object.keys(first.stats.averages).join(', '));
    } else {
      console.log('NO .average or .averages inside stats');
    }
    if (first.stats.total) {
      console.log('stats.total keys:', Object.keys(first.stats.total).join(', '));
    } else if (first.stats.totals) {
      console.log('stats.totals keys:', Object.keys(first.stats.totals).join(', '));
    }
  } else {
    console.log('NO .stats FIELD');
    // Check if stats are at top level
    console.log('first.games_count:', first.games_count);
    console.log('first.wins:', first.wins);
    if (first.average) console.log('first.average keys:', Object.keys(first.average).join(', '));
    if (first.averages) console.log('first.averages keys:', Object.keys(first.averages).join(', '));
  }

  // 3. Try the actual INSERT
  console.log('\n=== TESTING INSERT ===');
  const tc = first;
  const teamId = tc.team?.id ?? tc.id;
  if (!teamId) {
    console.log('SKIP: no team id found');
    await pool.end();
    return;
  }

  const s = tc.stats || {};
  const a = s.averages || s.average || {};
  const t = s.totals || s.total || {};

  console.log(`Team: ${tc.name} (${teamId})`);
  console.log(`s.games_count = ${s.games_count}`);
  console.log(`t.games_won = ${t.games_won}`);
  console.log(`t.games_lost = ${t.games_lost}`);
  console.log(`a.kills = ${a.kills}`);
  console.log(`a.gold_earned = ${a.gold_earned}`);
  console.log(`t.blue_games_won = ${t.blue_games_won}`);
  console.log(`t.chemtech_drake_kills = ${t.chemtech_drake_kills}`);

  try {
    await pool.query(`
      INSERT INTO team_career (
        team_id, serie_id,
        games, wins, losses, win_rate, avg_duration, avg_win_duration, avg_loss_duration,
        unique_champions, total_kills, total_deaths, total_assists,
        kills_avg, deaths_avg, assists_avg, kda,
        avg_cspm, gpm, egpm, dpm, delta_gpm, delta_cspm,
        blue_games, blue_wins, red_games, red_wins,
        avg_dtaken_pm, avg_magic_dpm, avg_physical_dpm, avg_true_dpm,
        avg_cc_per_min, avg_heal_per_min,
        avg_gold_diff_13, avg_gold_diff_14, avg_gold_diff_20, avg_gold_diff_25,
        avg_cs_diff_13, avg_cs_diff_14, avg_cs_diff_20, avg_cs_diff_25,
        avg_kills_diff_13, avg_kills_diff_14, avg_kills_diff_20, avg_kills_diff_25,
        avg_tower_diff_13, avg_tower_diff_20, avg_tower_diff_25,
        avg_drake_diff_13, avg_drake_diff_20, avg_drake_diff_25,
        avg_neutral_minions_team, avg_neutral_minions_enemy,
        avg_towers, avg_towers_lost, avg_plates, avg_inhibitors,
        avg_dragons, avg_elder_dragons, avg_barons, avg_heralds, avg_voidgrubs, avg_atakhans,
        first_blood_rate, first_tower_rate, first_dragon_rate, dragon_soul_rate,
        first_elder_rate, first_baron_rate, first_herald_rate, first_voidgrub_rate,
        first_atakhan_rate, first_inhibitor_rate,
        avg_wpm, avg_wkpm, avg_cwpm,
        avg_chemtech_drakes, avg_cloud_drakes, avg_hextech_drakes,
        avg_infernal_drakes, avg_mountain_drakes, avg_ocean_drakes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
        $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,$71,$72,$73,$74,$75,$76,$77,$78,$79,$80,$81,$82
      )
      ON CONFLICT (team_id, serie_id) DO UPDATE SET
        games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
        kda = EXCLUDED.kda, gpm = EXCLUDED.gpm, dpm = EXCLUDED.dpm,
        win_rate = EXCLUDED.win_rate
    `, [
      teamId, SERIE_ID,
      s.games_count ?? t.games_played ?? null,
      t.games_won ?? null, t.games_lost ?? null,
      (s.games_count && t.games_won != null) ? t.games_won / s.games_count : null,
      a.game_length ?? null, null, null,
      null,
      t.kills ?? null, t.deaths ?? null, t.assists ?? null,
      a.kills ?? null, a.deaths ?? null, a.assists ?? null,
      (t.kills && t.deaths) ? ((t.kills + (t.assists || 0)) / Math.max(t.deaths, 1)) : null,
      null, a.gold_earned ?? null, null,
      null, null, null,
      t.blue_games_won != null ? (t.blue_games_won + (t.blue_games_lost || 0)) : null,
      t.blue_games_won ?? null,
      t.red_games_won != null ? (t.red_games_won + (t.red_games_lost || 0)) : null,
      t.red_games_won ?? null,
      null, null, null, null,
      null, null,
      null, null, null, null,
      null, null, null, null,
      null, null, null, null,
      null, null, null,
      null, null, null,
      null, null,
      a.tower_kills ?? null, null, null, a.inhibitor_kills ?? null,
      a.dragon_kills ?? null, t.elder_drake_kills ?? null, a.baron_kills ?? null,
      a.herald_kill ?? null, a.voidgrub_kills ?? null, a.atakhan_kills ?? null,
      null, null, null, null,
      null, null, null, null,
      null, null,
      a.wards_placed ?? null, null, null,
      t.chemtech_drake_kills ? (t.chemtech_drake_kills / Math.max(s.games_count || 1, 1)) : null,
      t.cloud_drake_kills ? (t.cloud_drake_kills / Math.max(s.games_count || 1, 1)) : null,
      t.hextech_drake_kills ? (t.hextech_drake_kills / Math.max(s.games_count || 1, 1)) : null,
      t.infernal_drake_kills ? (t.infernal_drake_kills / Math.max(s.games_count || 1, 1)) : null,
      t.mountain_drake_kills ? (t.mountain_drake_kills / Math.max(s.games_count || 1, 1)) : null,
      t.ocean_drake_kills ? (t.ocean_drake_kills / Math.max(s.games_count || 1, 1)) : null,
    ]);
    console.log('✓ INSERT SUCCESS');
  } catch (e) {
    console.log(`✗ INSERT FAILED: ${e.message}`);
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
