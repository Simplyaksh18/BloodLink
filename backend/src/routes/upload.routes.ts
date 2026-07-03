import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { uploadDocument } from '../controllers/upload.controller';
import { authenticate } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/rateLimiter.middleware';

const storage = multer.diskStorage({
  destination: '/tmp/bloodlink-uploads',
  filename: (_req, file, cb) => {
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, safeName);
  },
});

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, PDF'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const router = Router();

router.post('/', authenticate, uploadRateLimiter, upload.single('file'), uploadDocument);

export default router;
