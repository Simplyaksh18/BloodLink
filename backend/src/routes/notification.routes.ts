import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllRead);
router.patch('/:id/read', notificationController.markRead);
router.delete('/:id', notificationController.deleteNotification);

// Phase 5C: push device token management
router.post('/device-token', notificationController.registerDeviceToken);
router.delete('/device-token', notificationController.removeDeviceToken);

export default router;
