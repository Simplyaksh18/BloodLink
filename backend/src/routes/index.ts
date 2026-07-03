import { Router } from 'express';
import authRoutes from './auth.routes';
import requestRoutes from './request.routes';
import donorRoutes from './donor.routes';
import donorStatusRoutes from './donorStatus.routes';
import bloodBankRoutes from './bloodBank.routes';
import notificationRoutes from './notification.routes';
import uploadRoutes from './upload.routes';
import adminRoutes from './admin.routes';
import sessionRoutes from './session.routes';
import verificationRoutes from './verification.routes';
import adminVerificationRoutes from './adminVerification.routes';
import devRoutes from './dev.routes';
import donationRoutes from './donation.routes';
import messagesRoutes from './messages.routes';
import { getMapData } from '../controllers/bloodBank.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

router.get('/health/security', (_req, res) => {
  res.json({
    success: true,
    data: {
      version: 'v1',
      securityHeaders: 'enabled',   // helmet
      rateLimit: 'enabled',          // 300/15min global, 10/15min auth
      auditLogging: 'enabled',       // AuditLog table + fire-and-forget service
      piiSanitizer: 'enabled',       // maskPhone/maskEmail + sanitizeBody in logging
      bodyLimit: '1mb',
      cors: process.env.CORS_ORIGIN ?? '*',
      timestamp: new Date().toISOString(),
    },
  });
});

router.use('/auth', authRoutes);
router.use('/requests', requestRoutes);
router.use('/donors', donorRoutes);
router.use('/donor', donorStatusRoutes);  // Phase 5: stateful donor status
router.use('/blood-banks', bloodBankRoutes);
router.use('/notifications', notificationRoutes);
router.use('/upload', uploadRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/verification', adminVerificationRoutes);
router.use('/sessions', sessionRoutes);
router.use('/verification', verificationRoutes);
router.get('/map', authenticate, getMapData);

router.use('/donations', donationRoutes);
router.use('/messages',  messagesRoutes);

// Dev-only QA endpoints. Router-level guard so nothing under /dev is even
// registered in production. Handlers additionally self-guard (defence-in-depth).
if (process.env.NODE_ENV !== 'production') {
  router.use('/dev', devRoutes);
  console.log('[Routes] /v1/dev mounted (development).');
} else {
  console.log('[Routes] /v1/dev NOT mounted (production).');
}

export default router;
