import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { donorStatusController } from '../controllers/donorStatus.controller';

const router = Router();

router.use(authenticate);

router.get('/status',       donorStatusController.getStatus);
router.post('/register',    donorStatusController.register);
router.post('/set-reminder', donorStatusController.setReminder);
router.delete('/reminder',  donorStatusController.cancelReminder);
router.put('/reactivate',   donorStatusController.reactivate);
router.post('/dev-reset',   donorStatusController.devReset);

export default router;
