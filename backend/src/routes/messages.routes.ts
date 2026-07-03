import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as messagesController from '../controllers/messages.controller';

const router = Router();

router.use(authenticate);

router.post('/blood-bank/:bankId/conversation',          messagesController.createBankConversation);
router.post('/bank-request/:requestId/conversation',     messagesController.createBankRequestConversation);
router.get('/conversations',                             messagesController.listConversations);
router.get('/conversations/:id',                         messagesController.getConversation);
router.post('/conversations/:id/messages',               messagesController.sendMessage);

export default router;
