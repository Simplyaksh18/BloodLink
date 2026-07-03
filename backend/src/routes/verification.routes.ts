import { Router } from 'express';
import * as verificationController from '../controllers/verification.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateUploadRequest } from '../middleware/fileValidation.middleware';

const router = Router();

router.use(authenticate);

router.post('/upload-url', validateUploadRequest, verificationController.requestUploadUrl);
router.post('/confirm-upload', verificationController.confirmUpload);
router.post('/submit', verificationController.submitVerification);
router.post('/resubmit', verificationController.resubmit);
router.get('/status', verificationController.getStatus);
router.get('/status/:type', verificationController.getStatusByType);
router.get('/history', verificationController.getHistory);
router.get('/documents', verificationController.getDocuments);
router.get('/documents/:id', verificationController.getDocumentById);
router.delete('/documents/:id', verificationController.deleteDocument);

export default router;
