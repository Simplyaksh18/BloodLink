import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { donorEligibilityController } from '../controllers/donorEligibility.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { donorFormSchema, healthScreeningSchema, setReminderSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Existing Phase 1–3 routes
router.get('/', userController.getDonorsByFilter);
router.get('/nearby', userController.getNearbyDonors);
router.get('/profile', userController.getDonorProfile);
router.put('/profile', validate(donorFormSchema), userController.updateDonorProfile);
router.get('/history', userController.getDonationHistory);

// Phase 4 — donor eligibility engine
router.post('/health-screening', validate(healthScreeningSchema), donorEligibilityController.submitHealthScreening);
router.get('/eligibility', donorEligibilityController.getEligibilityStatus);
router.put('/become-donor', donorEligibilityController.becomeDonor);
router.get('/document-status', donorEligibilityController.getDocumentStatus);
router.post('/set-reminder', validate(setReminderSchema), donorEligibilityController.setReminder);

export default router;
