import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { devController } from '../controllers/dev.controller';

const router = Router();

router.use(authenticate);

router.post('/donor/force-active',       devController.forceActiveDonor);
router.post('/donor/clear-force-active', devController.clearForceActiveDonor);
router.post('/donor/defer',              devController.deferDonor);
router.post('/verification/mark-verified', devController.markAllVerified);
router.post('/verification/reset',       devController.resetVerification);
router.post('/requests/:id/expire',      devController.expireRequest);
router.post('/requests/:id/notify-matches', devController.devNotifyMatches);

export default router;
