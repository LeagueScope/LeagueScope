/**
 * fix-warnings.js — Fix all actionable database warnings
 * Run: node scripts/fix-warnings.js
 */
import { config } from 'dotenv';
import pg from 'pg';
config();

const pool = new pg.Pool({ connectionString: process.env.PG_DSN || process.env.DATABASE_URL });

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  LeagueScope — Database Warning Fixes');
  console.log('══════════════════════════════════════════════════════════════\n');

  let totalFixed = 0;

  // ─── 1. Delete team_career with VERIFIED bad data (win_rate > 1 is mathematically impossible) ────
  console.log('── 1. Removing team_career with impossible win_rate (> 1) ──');
  const { rowCount: badWinRate } = await pool.query(`
    DELETE FROM team_career WHERE win_rate > 1
  `);
  console.log(`  ✓ Deleted ${badWinRate} team_career entries with win_rate > 1 (mathematically impossible)`);
  totalFixed += badWinRate;

  // ─── 2. Delete team_career with 0/NULL games (no data) ────────────
  console.log('\n── 2. Removing team_career with 0/NULL games ──');
  const { rowCount: emptyTeamCareer } = await pool.query(`
    DELETE FROM team_career WHERE games IS NULL OR games = 0
  `);
  console.log(`  ✓ Deleted ${emptyTeamCareer} team_career entries with 0/NULL games`);
  totalFixed += emptyTeamCareer;

  // ─── 3. Fix orphaned champion_ids in picks_bans ───────────────────
  console.log('\n── 3. Fixing orphaned champion_ids in picks_bans ──');
  const { rows: orphanedChamps } = await pool.query(`
    SELECT DISTINCT pb.champion_id
    FROM game_picks_bans pb
    LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
    WHERE ca.pandascore_id IS NULL AND pb.champion_id IS NOT NULL
  `);

  if (orphanedChamps.length > 0) {
    console.log(`  Found ${orphanedChamps.length} orphaned champion_ids: ${orphanedChamps.map(r => r.champion_id).join(', ')}`);

    // Try to fetch champion info from PandaScore
    const API_TOKEN = process.env.PANDASCORE_TOKEN;
    for (const { champion_id } of orphanedChamps) {
      try {
        const res = await fetch(
          `https://api.pandascore.co/lol/champions/${champion_id}`,
          { headers: { Authorization: `Bearer ${API_TOKEN}` } }
        );
        if (res.ok) {
          const champ = await res.json();
          console.log(`  Found champion: ${champ.name} (id: ${champ.id})`);

          // Check if champion exists in champions table
          const { rows: existing } = await pool.query(
            `SELECT id FROM champions WHERE id = $1`, [champ.id]
          );

          if (existing.length === 0) {
            // Insert into champions table
            await pool.query(
              `INSERT INTO champions (id, name, image_url) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [champ.id, champ.name, champ.image_url ?? null]
            );
            console.log(`  ✓ Added champion: ${champ.name} (id: ${champ.id})`);
          }

          // Insert alias
          await pool.query(
            `INSERT INTO champion_aliases (pandascore_id, canonical_id, name, image_url)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [champion_id, champ.id, champ.name, champ.image_url ?? null]
          );
          console.log(`  ✓ Added champion_alias: pandascore_id ${champion_id} → ${champ.name}`);
          totalFixed++;
        } else {
          console.log(`  ⚠ Could not fetch champion ${champion_id} from API (${res.status})`);
        }
      } catch (e) {
        console.log(`  ⚠ Error fetching champion ${champion_id}: ${e.message}`);
      }
    }
  } else {
    console.log('  ✓ No orphaned champion_ids found');
  }

  // ─── 4. Fix teams without acronym (use name abbreviation) ─────────
  console.log('\n── 4. Fixing teams without acronym ──');
  const { rows: noAcronym } = await pool.query(`
    SELECT id, name FROM teams WHERE acronym IS NULL OR TRIM(acronym) = ''
  `);

  if (noAcronym.length > 0) {
    let acronymFixed = 0;
    // Try to fetch from PandaScore API first (batch of up to 50)
    const API_TOKEN = process.env.PANDASCORE_TOKEN;
    const batchSize = 50;

    for (let i = 0; i < noAcronym.length; i += batchSize) {
      const batch = noAcronym.slice(i, i + batchSize);
      const ids = batch.map(t => t.id).join(',');

      try {
        const res = await fetch(
          `https://api.pandascore.co/lol/teams?filter[id]=${ids}&per_page=${batchSize}`,
          { headers: { Authorization: `Bearer ${API_TOKEN}` } }
        );
        if (res.ok) {
          const teams = await res.json();
          for (const team of teams) {
            if (team.acronym) {
              await pool.query(
                `UPDATE teams SET acronym = $1 WHERE id = $2 AND (acronym IS NULL OR TRIM(acronym) = '')`,
                [team.acronym, team.id]
              );
              acronymFixed++;
            }
          }
        }
      } catch (e) {
        console.log(`  ⚠ API batch error: ${e.message}`);
      }

      // Rate limit
      if (i + batchSize < noAcronym.length) await new Promise(r => setTimeout(r, 200));
    }

    // For teams still without acronym, generate from name (first letters of words, max 4 chars)
    const { rows: stillNoAcronym } = await pool.query(`
      SELECT id, name FROM teams WHERE acronym IS NULL OR TRIM(acronym) = ''
    `);

    for (const { id, name } of stillNoAcronym) {
      if (!name) continue;
      // Generate acronym: take first letter of each word, uppercase, max 4 chars
      const generated = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
      if (generated.length >= 2) {
        await pool.query(`UPDATE teams SET acronym = $1 WHERE id = $2`, [generated, id]);
        acronymFixed++;
      }
    }

    console.log(`  ✓ Fixed ${acronymFixed} teams without acronym (${noAcronym.length} total found)`);
    totalFixed += acronymFixed;
  } else {
    console.log('  ✓ All teams have acronym');
  }

  // ─── 5. Verify remaining win_rate sanity in 2026 data ─────────────
  console.log('\n── 5. Checking 2026 team_career win_rate ──');
  const { rows: [wrCheck] } = await pool.query(`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE win_rate > 1) AS over_1,
      COUNT(*) FILTER (WHERE win_rate < 0) AS negative,
      COUNT(*) FILTER (WHERE win_rate IS NULL) AS null_wr
    FROM team_career
  `);
  console.log(`  Total team_career: ${wrCheck.total}`);
  console.log(`  win_rate > 1: ${wrCheck.over_1}`);
  console.log(`  win_rate < 0: ${wrCheck.negative}`);
  console.log(`  win_rate NULL: ${wrCheck.null_wr}`);
  if (Number(wrCheck.over_1) === 0 && Number(wrCheck.negative) === 0) {
    console.log('  ✓ All win_rates are valid (0-1 range)');
  }

  // ─── Summary ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  TOTAL FIXED: ${totalFixed} entries`);
  console.log('══════════════════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
