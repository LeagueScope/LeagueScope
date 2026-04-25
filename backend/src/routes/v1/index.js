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
import { getOverviewPg, getTournamentPg, getHomeOverviewPg, getLiveStatusPg } from '../../controllers/pg/pgHome.js';
import { getFilterYearsPg, getFilterSeriesPg, getFilterStagesPg, getFilterInitPg } from '../../controllers/pg/pgFilters.js';
import { getHeadToHeadPg } from '../../controllers/pg/pgHeadToHead.js';
import { compareTeamsPg, comparePlayersPg, getPlayerSeriesPg, getTeamSeriesPg, getPlayerRoleBaselinePg } from '../../controllers/pg/pgCompare.js';
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


// ── Filters ─────────────────────────────────────────────────────────────────
router.get('/pg/filters/init',   ...common, asyncHandler(getFilterInitPg));
router.get('/pg/filters/years',  ...common, asyncHandler(getFilterYearsPg));
router.get('/pg/filters/series', ...common, asyncHandler(getFilterSeriesPg));
router.get('/pg/filters/stages', ...common, asyncHandler(getFilterStagesPg));

// ── Matches ─────────────────────────────────────────────────────────────────
router.get('/pg/matches',            ...common,        asyncHandler(getMatchesPg));
router.get('/pg/matches/:id/detail', validateUrlParams, asyncHandler(getMatchDetailPg));

// ── Home & Overview ─────────────────────────────────────────────────────────
router.get('/pg/home',        asyncHandler(getHomeOverviewPg));
router.get('/pg/live-status', asyncHandler(getLiveStatusPg));
router.get('/pg/overview',    ...common, asyncHandler(getOverviewPg));
router.get('/pg/tournament',  ...common, asyncHandler(getTournamentPg));

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
router.get('/pg/compare/teams',                 asyncHandler(compareTeamsPg));
router.get('/pg/compare/players',               asyncHandler(comparePlayersPg));
router.get('/pg/compare/player-series',         asyncHandler(getPlayerSeriesPg));
router.get('/pg/compare/team-series',           asyncHandler(getTeamSeriesPg));
router.get('/pg/compare/player-role-baseline',  asyncHandler(getPlayerRoleBaselinePg));

// ── Search ──────────────────────────────────────────────────────────────────
router.get('/pg/search', validateSearch, asyncHandler(searchPg));

// ── Player Evaluation (Arquetipos) ──────────────────────────────────────────
router.get('/pg/evaluation/:id', validateUrlParams, asyncHandler(getPlayerEvaluation));

export default router;
