import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getDonationHistory } from '../controllers/donation.controller';

const router = Router();

router.use(authenticate);
router.get('/history', getDonationHistory);

export default router;
