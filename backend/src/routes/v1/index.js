/**
 * API Routes v1 — PostgreSQL only
 *
 * All data served directly from PostgreSQL.
 * Input validation applied via middleware before each handler.
 */

import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import * as pgDb from '../../services/pgDb.js';
import {
  validateCommonParams,
  validateUrlParams,
  validateSearch,
  validateH2H,
  validatePagination,
  validatePosition,
} from '../../middleware/validateInput.js';

// ── PostgreSQL controllers ──────────────────────────────────────────────────
import { getMatchesPg, getMatchDetailPg } from '../../controllers/pg/pgMatches.js';
import { getTeamsPg, getTeamByAbbrPg } from '../../controllers/pg/pgTeams.js';
import { getPlayersPg, getPlayerByNamePg } from '../../controllers/pg/pgPlayers.js';
import { getChampionsPg, getChampionByNamePg, getChampionHistoryPg } from '../../controllers/pg/pgChampions.js';
import { getPlayerHistoryPg, getTeamHistoryPg } from '../../controllers/pg/pgHistory.js';
import { getOverviewPg, getTournamentPg, getHomeOverviewPg } from '../../controllers/pg/pgHome.js';
import { getFilterYearsPg, getFilterSeriesPg, getFilterStagesPg, getFilterInitPg } from '../../controllers/pg/pgFilters.js';
import { getHeadToHeadPg } from '../../controllers/pg/pgHeadToHead.js';
import { compareTeamsPg, comparePlayersPg, getPlayerSeriesPg, getTeamSeriesPg } from '../../controllers/pg/pgCompare.js';
import { searchPg } from '../../controllers/pg/pgSearch.js';
import { getPlayerEvaluation } from '../../controllers/pg/pgEvaluation.js';

const router = Router();

// ── Common validation for all /pg/ routes with league/year/split/stage ───────
const common = [validateCommonParams];
const commonWithUrl = [validateCommonParams, validateUrlParams];

// Health — always returns 200 so App Runner doesn't rollback, but reports DB status
router.get('/health', async (req, res) => {
  let db = 'unknown';
  let dbError = null;
  try {
    await pgDb.query('SELECT 1 AS ok');
    db = 'connected';
  } catch (err) {
    db = 'disconnected';
    dbError = err.message;
  }
  res.json({ status: 'ok', source: 'postgresql', db, dbError });
});

// Diagnostic — shows PG_DSN format (masked) for debugging
router.get('/diag', (req, res) => {
  const dsn = process.env.PG_DSN || '(not set)';
  const len = dsn.length;
  // Show first 15 chars and last 10, mask the rest
  const masked = len > 30
    ? dsn.slice(0, 15) + '***' + dsn.slice(-10)
    : dsn.slice(0, 5) + '***';
  // Check for common issues
  const issues = [];
  if (dsn.startsWith(' ') || dsn.startsWith('"') || dsn.startsWith("'")) issues.push('starts with whitespace or quote');
  if (dsn.endsWith(' ') || dsn.endsWith('"') || dsn.endsWith("'")) issues.push('ends with whitespace or quote');
  if (!dsn.startsWith('postgres')) issues.push('does not start with postgres://');
  if (dsn.includes(' ') && !dsn.startsWith('/')) issues.push('contains spaces');

  // Test URL parsing (same as pg-connection-string does)
  let urlValid = false;
  try {
    new URL(dsn, 'postgres://base');
    urlValid = true;
  } catch (e) {
    issues.push(`URL parse error: ${e.message}`);
  }

  res.json({ dsn_length: len, dsn_masked: masked, urlValid, issues, node_env: process.env.NODE_ENV });
});

// ── Filters ─────────────────────────────────────────────────────────────────
router.get('/pg/filters/init',   ...common, asyncHandler(getFilterInitPg));
router.get('/pg/filters/years',  ...common, asyncHandler(getFilterYearsPg));
router.get('/pg/filters/series', ...common, asyncHandler(getFilterSeriesPg));
router.get('/pg/filters/stages', ...common, asyncHandler(getFilterStagesPg));

// ── Matches ─────────────────────────────────────────────────────────────────
router.get('/pg/matches',            ...common,        asyncHandler(getMatchesPg));
router.get('/pg/matches/:id/detail', validateUrlParams, asyncHandler(getMatchDetailPg));

// ── Home & Overview ─────────────────────────────────────────────────────────
router.get('/pg/home',       asyncHandler(getHomeOverviewPg));
router.get('/pg/overview',   ...common, asyncHandler(getOverviewPg));
router.get('/pg/tournament', ...common, asyncHandler(getTournamentPg));

// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/pg/teams',       ...common,        asyncHandler(getTeamsPg));
router.get('/pg/teams/:abbr', ...commonWithUrl,  asyncHandler(getTeamByAbbrPg));

// ── Players ─────────────────────────────────────────────────────────────────
router.get('/pg/players',       ...common, validatePosition, asyncHandler(getPlayersPg));
router.get('/pg/players/:name', ...commonWithUrl,             asyncHandler(getPlayerByNamePg));

// ── Champions ───────────────────────────────────────────────────────────────
router.get('/pg/champions',       ...common,        asyncHandler(getChampionsPg));
router.get('/pg/champions/:name', ...commonWithUrl,  asyncHandler(getChampionByNamePg));

// ── History ─────────────────────────────────────────────────────────────────
router.get('/pg/player-history/:name',        validateUrlParams, validatePagination, asyncHandler(getPlayerHistoryPg));
router.get('/pg/team-history/:identifier',    validateUrlParams, validatePagination, asyncHandler(getTeamHistoryPg));
router.get('/pg/champion-history/:name',      ...commonWithUrl,  asyncHandler(getChampionHistoryPg));

// ── Head to Head ────────────────────────────────────────────────────────────
router.get('/pg/headtohead', ...common, validateH2H, asyncHandler(getHeadToHeadPg));

// ── Compare (Global H2H) ─────────────────────────────────────────────────────
router.get('/pg/compare/teams',          asyncHandler(compareTeamsPg));
router.get('/pg/compare/players',        asyncHandler(comparePlayersPg));
router.get('/pg/compare/player-series',  asyncHandler(getPlayerSeriesPg));
router.get('/pg/compare/team-series',    asyncHandler(getTeamSeriesPg));

// ── Search ──────────────────────────────────────────────────────────────────
router.get('/pg/search', validateSearch, asyncHandler(searchPg));

// ── Player Evaluation (Arquetipos) ──────────────────────────────────────────
router.get('/pg/evaluation/:id', validateUrlParams, asyncHandler(getPlayerEvaluation));

export default router;
