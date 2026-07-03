import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { adminReviewSchema } from '../utils/validators';

const router = Router();

router.use(authenticate, requireRole('ADMIN', 'SUPER_ADMIN'));

router.post('/donors', adminController.addDonor);
router.put('/donors/upsert', adminController.upsertDonor);
router.delete('/donors/:id', adminController.removeDonor);
router.get('/donors/imported/verify', adminController.verifyImportedDonors);
router.post('/blood-banks', adminController.addBloodBank);
router.get('/blood-banks', adminController.listBloodBanks);
router.get('/blood-banks/:id', adminController.getBloodBankDetail);
router.delete('/blood-banks/:id', adminController.removeBloodBank);
router.get('/verifications', adminController.getPendingVerifications);
router.put('/verifications/:id', validate(adminReviewSchema), adminController.reviewVerification);

export default router;
