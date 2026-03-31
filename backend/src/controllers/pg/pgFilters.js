import { pgDb, resolveLeagueId } from './pgHelpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Unified filter init — returns years + series + stages in ONE round-trip
   GET /pg/filters/init?league=LEC
   Optional: &year=2024          → skip year detection, use this year
             &split=Spring       → skip split detection, use this split
   ═══════════════════════════════════════════════════════════════════════════ */

export async function getFilterInitPg(req, res) {
  const { league = 'LEC', year: qYear, split: qSplit } = req.query;
  const leagueId = await resolveLeagueId(league);
  if (!leagueId) return res.json({ years: [], series: [], stages: [] });

  // 1) Years
  const { rows: yrRows } = await pgDb.query(`
    SELECT DISTINCT s.year
    FROM series s
    WHERE s.league_id = $1 AND s.year IS NOT NULL
    ORDER BY s.year DESC
  `, [leagueId]);
  const years = yrRows.map(r => r.year);
  if (!years.length) return res.json({ years: [], series: [], stages: [] });

  // 2) Determine target year (use provided or find first with series)
  let targetYear = qYear ? Number(qYear) : null;
  let series = [];

  if (targetYear) {
    const { rows } = await pgDb.query(`
      SELECT s.id, s.season AS name, s.year, s.full_name, s.begin_at, s.end_at
      FROM series s
      WHERE s.league_id = $1 AND s.year = $2
      ORDER BY s.begin_at DESC NULLS LAST, s.id DESC
    `, [leagueId, targetYear]);
    series = rows;
  } else {
    // Find first year (most recent) that has series
    for (const yr of years) {
      const { rows } = await pgDb.query(`
        SELECT s.id, s.season AS name, s.year, s.full_name, s.begin_at, s.end_at
        FROM series s
        WHERE s.league_id = $1 AND s.year = $2
        ORDER BY s.begin_at DESC NULLS LAST, s.id DESC
      `, [leagueId, yr]);
      if (rows.length > 0) {
        targetYear = yr;
        series = rows;
        break;
      }
    }
  }

  if (!targetYear || !series.length) {
    return res.json({ years, series: [], stages: [], year: years[0] || null });
  }

  // 3) Determine target split
  const targetSplit = qSplit || series[0].name || series[0].full_name || `Serie ${series[0].id}`;

  // 4) Resolve serie → stages
  const { rows: serieRows } = await pgDb.query(`
    SELECT s.id
    FROM series s
    WHERE s.league_id = $1 AND s.year = $2
      AND (s.season = $3 OR s.full_name = $3)
    ORDER BY s.begin_at DESC NULLS LAST
    LIMIT 1
  `, [leagueId, targetYear, targetSplit]);

  let stages = [];
  if (serieRows.length) {
    const { rows: stRows } = await pgDb.query(`
      SELECT id, name, slug, begin_at, end_at
      FROM tournaments
      WHERE serie_id = $1
      ORDER BY begin_at ASC NULLS LAST
    `, [serieRows[0].id]);
    stages = stRows.map(t => ({
      id: t.id,
      name: t.name,
      type: t.slug,
      begin_at: t.begin_at,
      end_at: t.end_at,
    }));
  }

  res.json({ years, series, stages, year: targetYear, split: targetSplit });
}

export async function getFilterYearsPg(req, res) {
  const { league = 'LEC' } = req.query;
  const leagueId = await resolveLeagueId(league);
  if (!leagueId) return res.json([]);
  const { rows } = await pgDb.query(`
    SELECT DISTINCT s.year
    FROM series s
    WHERE s.league_id = $1 AND s.year IS NOT NULL
    ORDER BY s.year DESC
  `, [leagueId]);
  res.json(rows.map(r => r.year));
}

export async function getFilterSeriesPg(req, res) {
  const { league = 'LEC', year } = req.query;
  const leagueId = await resolveLeagueId(league);
  if (!leagueId) return res.json([]);
  const params = [leagueId];
  let yearFilter = '';
  if (year) {
    params.push(Number(year));
    yearFilter = ` AND s.year = $${params.length}`;
  }
  const { rows } = await pgDb.query(`
    SELECT s.id, s.season AS name, s.year, s.full_name, s.begin_at, s.end_at
    FROM series s
    WHERE s.league_id = $1${yearFilter}
    ORDER BY s.begin_at DESC NULLS LAST, s.id DESC
  `, params);
  res.json(rows);
}

export async function getFilterStagesPg(req, res) {
  const { league = 'LEC', year, split } = req.query;
  const leagueId = await resolveLeagueId(league);
  if (!leagueId) return res.json([]);

  // First resolve the serie_id from league + year + split
  const params = [leagueId];
  let filters = '';
  if (year) {
    params.push(Number(year));
    filters += ` AND s.year = $${params.length}`;
  }
  if (split) {
    params.push(split);
    filters += ` AND (s.season = $${params.length} OR s.full_name = $${params.length})`;
  }

  const { rows: serieRows } = await pgDb.query(`
    SELECT s.id
    FROM series s
    WHERE s.league_id = $1${filters}
    ORDER BY s.begin_at DESC NULLS LAST
    LIMIT 1
  `, params);

  if (!serieRows.length) return res.json([]);

  const serieId = serieRows[0].id;

  const { rows } = await pgDb.query(`
    SELECT id, name, slug, begin_at, end_at
    FROM tournaments
    WHERE serie_id = $1
    ORDER BY begin_at ASC NULLS LAST
  `, [serieId]);

  res.json(rows.map(t => ({
    id: t.id,
    name: t.name,
    type: t.slug,
    begin_at: t.begin_at,
    end_at: t.end_at,
  })));
}
