import { Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError } from '../utils/ApiError';
import { VerificationType } from '@prisma/client';
import * as verificationService from '../services/verification.service';
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from '../types/verification.types';
import path from 'path';

function parseVerificationType(raw: unknown): VerificationType {
  const valid = Object.values(VerificationType);
  if (typeof raw !== 'string' || !valid.includes(raw as VerificationType)) {
    throw new BadRequestError(`documentType must be one of: ${valid.join(', ')}`);
  }
  return raw as VerificationType;
}

export const requestUploadUrl = asyncHandler(async (req: Request, res: Response) => {
  const { documentType, fileName, fileType, fileSize } = req.body;

  if (!documentType || !fileName || !fileType) {
    throw new BadRequestError('documentType, fileName, and fileType are required');
  }

  const type = parseVerificationType(documentType);

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(fileType)) {
    throw new BadRequestError(`fileType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BadRequestError(`File extension must be one of: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  const result = await verificationService.initiateUpload(req.user!.userId, type, fileName, fileType, fileSize);
  ApiResponse.created(res, result, 'Upload URL generated');
});

export const confirmUpload = asyncHandler(async (req: Request, res: Response) => {
  const { documentId, s3Key, fileSize } = req.body;
  if (!documentId || !s3Key) throw new BadRequestError('documentId and s3Key are required');

  const result = await verificationService.confirmUpload(req.user!.userId, documentId, s3Key, fileSize);
  ApiResponse.success(res, result, 'Upload confirmed');
});

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = await verificationService.getVerificationStatus(req.user!.userId);
  ApiResponse.success(res, status);
});

export const getStatusByType = asyncHandler(async (req: Request, res: Response) => {
  const type = parseVerificationType(req.params.type?.toUpperCase());
  const result = await verificationService.getVerificationStatusByType(req.user!.userId, type);
  ApiResponse.success(res, result);
});

export const submitVerification = asyncHandler(async (req: Request, res: Response) => {
  const { verificationType, s3Key, documentDate } = req.body;
  if (!verificationType || !s3Key) throw new BadRequestError('verificationType and s3Key are required');

  const type = parseVerificationType(verificationType);

  // For submit: find the pending NOT_SUBMITTED record and confirm it
  const existing = await verificationService.getVerificationStatusByType(req.user!.userId, type);
  if (!existing) throw new BadRequestError('No upload initiated for this document type. Call upload-url first.');

  if (documentDate) {
    const { prisma } = await import('../config/database');
    await prisma.verification.update({ where: { id: existing.id }, data: { documentDate: new Date(documentDate) } });
  }

  const result = await verificationService.confirmUpload(req.user!.userId, existing.id, s3Key);
  ApiResponse.created(res, result, 'Verification submitted');
});

export const resubmit = asyncHandler(async (req: Request, res: Response) => {
  const { verificationId, s3Key, reason } = req.body;
  if (!verificationId || !s3Key || !reason) throw new BadRequestError('verificationId, s3Key, and reason are required');

  const result = await verificationService.resubmit(req.user!.userId, verificationId, s3Key, reason);
  ApiResponse.success(res, result, 'Verification resubmitted');
});

export const getDocuments = asyncHandler(async (req: Request, res: Response) => {
  const docs = await verificationService.getDocuments(req.user!.userId);
  ApiResponse.success(res, docs);
});

export const getDocumentById = asyncHandler(async (req: Request, res: Response) => {
  const doc = await verificationService.getDocument(req.user!.userId, req.params.id);
  ApiResponse.success(res, doc);
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  await verificationService.deleteDocument(req.user!.userId, req.params.id);
  ApiResponse.success(res, null, 'Document deleted');
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await verificationService.getHistory(req.user!.userId);
  ApiResponse.success(res, history);
});
