import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as sessionController from '../controllers/session.controller';

const router = Router();

router.use(authenticate);

router.get('/', sessionController.listSessions);
router.delete('/', sessionController.deleteAllOtherSessions);
router.delete('/:id', sessionController.deleteSession);

export default router;
