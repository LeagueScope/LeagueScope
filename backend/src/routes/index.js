/**
 * Router principal
 */

import { Router } from 'express';
import v1Routes from './v1/index.js';

const router = Router();

// API v1
router.use('/v1', v1Routes);

// Compatibilidad sin versión
router.use('/', v1Routes);

export default router;
