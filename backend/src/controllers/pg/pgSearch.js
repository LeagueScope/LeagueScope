import { pgDb } from './pgHelpers.js';

/**
 * GET /pg/search?q=faker
 * Searches players and teams in PostgreSQL.
 * Returns { players: [...], teams: [...] }
 */
export async function searchPg(req, res) {
  const q = (req.query.q || '').trim().slice(0, 50);
  if (!q || q.length < 2) return res.json({ players: [], teams: [], champions: [] });

  const needle = `%${q}%`;

  const [{ rows: playerRows }, { rows: teamRows }, { rows: championRows }] = await Promise.all([
    pgDb.query(`
      SELECT p.id, p.name, p.role, p.image_url, p.nationality,
             p.current_team_id,
             t.name AS current_team, t.acronym AS current_team_abbr
      FROM players p
      LEFT JOIN teams t ON t.id = p.current_team_id
      WHERE p.name ILIKE $1
      ORDER BY
        CASE WHEN LOWER(p.name) LIKE $2 THEN 0 ELSE 1 END,
        p.name
      LIMIT 15
    `, [needle, q.toLowerCase() + '%']),

    pgDb.query(`
      SELECT t.id, t.name, t.acronym, t.slug,
             COALESCE(t.dark_mode_image_url, t.image_url) AS image_url
      FROM teams t
      WHERE t.name ILIKE $1 OR t.acronym ILIKE $1
      ORDER BY
        CASE WHEN LOWER(t.acronym) LIKE $2 THEN 0 ELSE 1 END,
        t.name
      LIMIT 15
    `, [needle, q.toLowerCase() + '%']),

    pgDb.query(`
      SELECT c.id, c.name, c.image_url
      FROM champions c
      WHERE c.name ILIKE $1
      ORDER BY
        CASE WHEN LOWER(c.name) LIKE $2 THEN 0 ELSE 1 END,
        c.name
      LIMIT 10
    `, [needle, q.toLowerCase() + '%']),
  ]);

  const players = playerRows.map(p => ({
    id: p.id,
    name: p.name,
    role: p.role ?? null,
    image_url: p.image_url ?? null,
    nationality: p.nationality ?? null,
    current_team: p.current_team ?? null,
    current_team_abbr: p.current_team_abbr ?? null,
  }));

  const teams = teamRows.map(t => ({
    id: t.id,
    name: t.name,
    acronym: t.acronym ?? null,
    slug: t.slug ?? null,
    image_url: t.image_url ?? null,
  }));

  const champions = championRows.map(c => ({
    id: c.id,
    name: c.name,
    image_url: c.image_url ?? null,
  }));

  res.json({ players, teams, champions });
}
