#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PG_DSN });
async function main() {
  const { rows } = await pool.query(`
    SELECT id, name, slug FROM leagues
    WHERE id IN (4533, 5377) OR LOWER(name) LIKE '%desaf%' OR LOWER(name) LIKE '%circuito%'
  `);
  for (const r of rows) console.log(`${r.id}: ${r.name} (${r.slug})`);
  await pool.end();
}
main().catch(console.error);
