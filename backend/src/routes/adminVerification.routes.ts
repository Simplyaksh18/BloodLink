import { Router } from 'express';
import * as adminVerificationController from '../controllers/adminVerification.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN', 'MODERATOR'));

router.get('/queue', adminVerificationController.getQueue);
router.get('/stats', adminVerificationController.getStats);
router.get('/fraud-alerts', adminVerificationController.getFraudAlerts);
router.get('/fraud-alerts/high-score', adminVerificationController.getHighFraudVerifications);
router.patch('/fraud-alerts/:alertId/resolve', adminVerificationController.resolveFraudAlert);
router.get('/:id', adminVerificationController.getVerificationDetail);
router.post('/:id/approve', adminVerificationController.approve);
router.post('/:id/reject', adminVerificationController.reject);
router.post('/:id/assign', adminVerificationController.assign);

export default router;
