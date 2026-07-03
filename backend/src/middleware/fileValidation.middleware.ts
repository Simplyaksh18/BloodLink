import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../utils/ApiError';
import {
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_PDF_SIZE_BYTES,
} from '../types/verification.types';
import path from 'path';

export function validateUploadRequest(req: Request, _res: Response, next: NextFunction): void {
  const { fileName, fileType, fileSize } = req.body;

  if (!fileName || typeof fileName !== 'string') {
    next(new BadRequestError('fileName is required'));
    return;
  }

  if (!fileType || typeof fileType !== 'string') {
    next(new BadRequestError('fileType is required'));
    return;
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(fileType)) {
    next(new BadRequestError(`fileType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`));
    return;
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    next(new BadRequestError(`File extension must be one of: ${ALLOWED_EXTENSIONS.join(', ')}`));
    return;
  }

  if (fileSize !== undefined) {
    const maxSize = fileType === 'application/pdf' ? MAX_PDF_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
    if (typeof fileSize !== 'number' || fileSize > maxSize) {
      const limitMB = maxSize / (1024 * 1024);
      next(new BadRequestError(`File size exceeds limit of ${limitMB}MB for ${fileType}`));
      return;
    }
  }

  // Sanitise fileName to prevent path traversal
  const safeName = path.basename(fileName);
  req.body.fileName = safeName;

  next();
}
