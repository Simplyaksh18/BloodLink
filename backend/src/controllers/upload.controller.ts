import { Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError } from '../utils/ApiError';
import { uploadFile } from '../services/upload.service';

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new BadRequestError('No file provided');

  const documentType = req.body.documentType ?? 'medical_report';

  const result = await uploadFile(
    req.file.path,
    req.file.originalname,
    req.file.mimetype,
    documentType,
    req.user!.userId
  );

  ApiResponse.created(res, result, 'File uploaded successfully');
});
