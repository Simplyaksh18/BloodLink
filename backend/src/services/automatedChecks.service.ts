import { Verification, VerificationType, User } from '@prisma/client';
import {
  AutoCheckResult,
  AutoChecksOutput,
  ConfidenceBreakdown,
  MEDICAL_SCREENING_VALIDITY_DAYS,
  BLOOD_GROUP_CERT_VALIDITY_DAYS,
  ALLOWED_MIME_TYPES,
} from '../types/verification.types';
import { verificationRepository } from '../repositories/verification.repository';
import { analyzeDocument } from './documentAnalysis.service';
import { computeConfidenceScore } from './confidenceScore.service';
import { logger } from '../config/logger';

const MIN_IMAGE_SIZE_BYTES = 100 * 1024;   // 100 KB
const MIN_PDF_SIZE_BYTES  = 50 * 1024;    // 50 KB
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_SIZE_BYTES   = 10 * 1024 * 1024;

function mimeCheck(fileType: string | null): AutoCheckResult {
  const ok = fileType ? (ALLOWED_MIME_TYPES as readonly string[]).includes(fileType) : false;
  return {
    checkName: 'mime_type',
    passed: ok,
    message: ok ? 'Valid file type' : `Invalid file type: ${fileType ?? 'unknown'}`,
    suggestion: ok ? undefined : 'Please upload a JPG, PNG, or PDF file.',
  };
}

function sizeCheck(fileSize: number | null, fileType: string | null): AutoCheckResult {
  if (!fileSize) {
    return { checkName: 'file_size', passed: true, message: 'File size not provided — skipping size check' };
  }
  const isPdf = fileType === 'application/pdf';
  const maxSize = isPdf ? MAX_PDF_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  const minSize = isPdf ? MIN_PDF_SIZE_BYTES  : MIN_IMAGE_SIZE_BYTES;
  const maxMB   = isPdf ? 10 : 5;
  const minKB   = isPdf ? 50 : 100;

  if (fileSize > maxSize) {
    return {
      checkName: 'file_size',
      passed: false,
      message: `File is too large (${(fileSize / (1024 * 1024)).toFixed(1)} MB). Maximum: ${maxMB} MB.`,
      suggestion: `Compress the file to under ${maxMB} MB before uploading.`,
    };
  }
  if (fileSize < minSize) {
    return {
      checkName: 'file_size',
      passed: false,
      message: `File is too small (${(fileSize / 1024).toFixed(0)} KB). Minimum: ${minKB} KB.`,
      suggestion: 'The image appears too small or low-resolution. Upload a clearer, higher-quality scan.',
    };
  }
  return { checkName: 'file_size', passed: true, message: 'File size within acceptable limits' };
}

async function checkIdProof(v: Verification, _user: User): Promise<{ results: AutoCheckResult[]; fraudIndicators: string[] }> {
  const results: AutoCheckResult[] = [];
  const fraudIndicators: string[] = [];

  const mime = mimeCheck(v.fileType);
  results.push(mime);
  if (!mime.passed) fraudIndicators.push('INVALID_FILE_TYPE');

  results.push(sizeCheck(v.fileSize, v.fileType));

  if (v.s3Key) {
    const duplicate = await verificationRepository.findDuplicateS3Key(v.s3Key, v.userId);
    const noDup = !duplicate;
    results.push({
      checkName: 'duplicate_check',
      passed: noDup,
      message: noDup ? 'No duplicate document found' : 'This document has already been submitted by another user.',
      suggestion: noDup ? undefined : 'Please upload your own original government-issued ID.',
    });
    if (!noDup) fraudIndicators.push('DUPLICATE_DOCUMENT');
  }

  return { results, fraudIndicators };
}

async function checkBloodGroupProof(v: Verification, user: User): Promise<{ results: AutoCheckResult[]; fraudIndicators: string[] }> {
  const results: AutoCheckResult[] = [];
  const fraudIndicators: string[] = [];

  const mime = mimeCheck(v.fileType);
  results.push(mime);
  if (!mime.passed) fraudIndicators.push('INVALID_FILE_TYPE');

  results.push(sizeCheck(v.fileSize, v.fileType));

  if (v.documentDate) {
    const ageDays = (Date.now() - new Date(v.documentDate).getTime()) / (1000 * 60 * 60 * 24);
    const fresh = ageDays <= BLOOD_GROUP_CERT_VALIDITY_DAYS;
    results.push({
      checkName: 'document_freshness',
      passed: fresh,
      message: fresh
        ? 'Certificate is within the 1-year validity period'
        : `Certificate is ${Math.floor(ageDays)} days old. Must be within 1 year (365 days).`,
      suggestion: fresh ? undefined : 'Upload a blood group certificate issued within the last 12 months.',
    });
    if (!fresh) fraudIndicators.push('STALE_CERTIFICATE');
  } else {
    results.push({ checkName: 'document_freshness', passed: true, message: 'Document date not provided — freshness not checked' });
  }

  const hasBG = Boolean(user.bloodGroup);
  results.push({
    checkName: 'blood_group_declared',
    passed: hasBG,
    message: hasBG ? 'Blood group declared in profile' : 'No blood group set in your profile.',
    suggestion: hasBG ? undefined : 'Update your profile to include your blood group before submitting this document.',
  });

  return { results, fraudIndicators };
}

async function checkMedicalScreening(v: Verification, _user: User): Promise<{ results: AutoCheckResult[]; fraudIndicators: string[] }> {
  const results: AutoCheckResult[] = [];
  const fraudIndicators: string[] = [];

  const mime = mimeCheck(v.fileType);
  results.push(mime);
  if (!mime.passed) fraudIndicators.push('INVALID_FILE_TYPE');

  results.push(sizeCheck(v.fileSize, v.fileType));

  if (v.documentDate) {
    const ageDays = (Date.now() - new Date(v.documentDate).getTime()) / (1000 * 60 * 60 * 24);
    const fresh = ageDays <= MEDICAL_SCREENING_VALIDITY_DAYS;
    results.push({
      checkName: 'screening_freshness',
      passed: fresh,
      message: fresh
        ? 'Medical screening is within the 6-month validity period'
        : `Screening is ${Math.floor(ageDays)} days old. Must be within 6 months (180 days).`,
      suggestion: fresh ? undefined : 'Please get a new medical screening done and upload a recent report.',
    });
    if (!fresh) fraudIndicators.push('EXPIRED_MEDICAL_SCREENING');
  } else {
    results.push({
      checkName: 'screening_freshness',
      passed: true,
      message: 'Screening date not provided — accepted without date validation',
    });
  }

  return { results, fraudIndicators };
}

async function checkLicense(v: Verification, user: User): Promise<{ results: AutoCheckResult[]; fraudIndicators: string[] }> {
  const results: AutoCheckResult[] = [];
  const fraudIndicators: string[] = [];

  const mime = mimeCheck(v.fileType);
  results.push(mime);
  if (!mime.passed) fraudIndicators.push('INVALID_FILE_TYPE');

  results.push(sizeCheck(v.fileSize, v.fileType));

  const validRole = user.role === 'BLOOD_BANK' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  results.push({
    checkName: 'user_role',
    passed: validRole,
    message: validRole ? 'Account has the required Blood Bank role' : 'License documents are only for Blood Bank accounts.',
    suggestion: validRole ? undefined : 'Switch your account type to Blood Bank to submit a license document.',
  });
  if (!validRole) fraudIndicators.push('ROLE_MISMATCH');

  if (v.documentDate) {
    const expired = new Date(v.documentDate) < new Date();
    results.push({
      checkName: 'license_expiry',
      passed: !expired,
      message: !expired ? 'License is current and not expired' : 'This license has expired.',
      suggestion: expired ? 'Please upload a current, valid license certificate.' : undefined,
    });
    if (expired) fraudIndicators.push('EXPIRED_LICENSE');
  } else {
    results.push({ checkName: 'license_expiry', passed: true, message: 'License expiry date not provided' });
  }

  return { results, fraudIndicators };
}

const FALLBACK_CONFIDENCE: ConfidenceBreakdown = {
  totalConfidence: 0,
  documentQuality: {
    score: 0, maxScore: 25,
    details: { sharpness: 0, contrast: 0, alignment: 0, readability: 0 },
    issues: ['Analysis failed due to system error.'],
  },
  ocrExtraction: {
    score: 0, maxScore: 35,
    details: { fieldsExtracted: '0/0', averageFieldConfidence: 0, missingFields: [] },
    issues: ['Analysis failed due to system error.'],
  },
  dataConsistency: {
    score: 0, maxScore: 30,
    details: { nameMatch: 0, dobMatch: 0, bloodGroupMatch: 0, documentTypeMatch: 0 },
    issues: [],
  },
  securityChecks: {
    score: 0, maxScore: 10,
    details: { isUnique: false, tamperingDetected: false, fraudFlagCount: 1 },
    issues: ['System error during security check.'],
  },
  recommendedAction: 'System error — manual review required',
  processingTimeMs: 0,
};

export async function runAutomatedChecks(v: Verification, user: User): Promise<AutoChecksOutput> {
  try {
    let checkOutput: { results: AutoCheckResult[]; fraudIndicators: string[] };

    switch (v.verificationType) {
      case VerificationType.ID_PROOF:
        checkOutput = await checkIdProof(v, user);
        break;
      case VerificationType.BLOOD_GROUP_PROOF:
        checkOutput = await checkBloodGroupProof(v, user);
        break;
      case VerificationType.MEDICAL_SCREENING:
        checkOutput = await checkMedicalScreening(v, user);
        break;
      case VerificationType.LICENSE:
        checkOutput = await checkLicense(v, user);
        break;
      default:
        checkOutput = { results: [], fraudIndicators: [] };
    }

    const passed = checkOutput.results.every((r) => r.passed);
    const fraudScoreDelta = checkOutput.fraudIndicators.length * 15;

    // Document content analysis + confidence scoring (mock in DEV, AI in PROD)
    const analysis = await analyzeDocument(v, user);
    const confidenceBreakdown = computeConfidenceScore(analysis, checkOutput.results, checkOutput.fraudIndicators);

    return {
      passed,
      results: checkOutput.results,
      fraudIndicators: checkOutput.fraudIndicators,
      fraudScoreDelta,
      confidenceBreakdown,
    };
  } catch (err) {
    logger.error('Automated checks failed', { verificationId: v.id, err });
    return {
      passed: false,
      results: [{ checkName: 'system', passed: false, message: 'Internal check error', suggestion: 'Please try again later.' }],
      fraudIndicators: ['CHECK_ERROR'],
      fraudScoreDelta: 10,
      confidenceBreakdown: FALLBACK_CONFIDENCE,
    };
  }
}
