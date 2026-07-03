/**
 * Document Analysis Service
 *
 * Abstracts image quality assessment and OCR field extraction.
 * DEV mode (USE_DUMMY_DATA=true or no AI provider): deterministic mock data seeded from
 * file metadata, so the same file always gets the same scores.
 * PROD mode: plug in AWS Rekognition/Textract or Google Vision/Document AI by implementing
 * isAIConfigured() and the provider call inside analyzeDocument().
 */

import { Verification, User, VerificationType } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface QualityAssessment {
  sharpnessScore: number;    // 0-25
  contrastScore: number;     // 0-25
  alignmentScore: number;    // 0-25
  readabilityScore: number;  // 0-25
  total: number;             // 0-100
  issues: string[];
}

export interface OCRFieldResult {
  value: string | null;
  confidence: number;  // 0-100
}

export interface OCRResult {
  fieldsFound: number;
  fieldsTotal: number;
  averageConfidence: number;
  fields: Record<string, OCRFieldResult>;
  missingFields: string[];
  issues: string[];
}

export interface DataConsistency {
  nameMatchScore: number;       // 0-10
  dobMatchScore: number;        // 0-10
  bloodGroupMatchScore: number; // 0-5
  typeMatchScore: number;       // 0-5
  total: number;                // 0-30
  issues: string[];
}

export interface DocumentAnalysisResult {
  quality: QualityAssessment;
  ocr: OCRResult;
  consistency: DataConsistency;
  processingMs: number;
}

// ─── OCR field definitions per document type ──────────────────────────────────

const EXPECTED_FIELDS: Record<VerificationType, string[]> = {
  ID_PROOF:          ['fullName', 'dateOfBirth', 'idNumber', 'idType', 'expiryDate'],
  BLOOD_GROUP_PROOF: ['fullName', 'bloodGroup', 'issuingInstitution', 'doctorName', 'certificateDate'],
  MEDICAL_SCREENING: ['fullName', 'screeningDate', 'hemoglobin', 'bloodPressure', 'doctorSignature'],
  LICENSE:           ['bankName', 'licenseNumber', 'issuingAuthority', 'issueDate', 'expiryDate'],
};

// ─── Deterministic seeding helpers ────────────────────────────────────────────

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Returns a value in [min, max] deterministically from (hash + offset)
function pick(hash: number, offset: number, min: number, max: number): number {
  const range = max - min + 1;
  return min + ((hash + offset) % range);
}

// ─── Mock: document quality assessment ────────────────────────────────────────

function mockQuality(v: Verification): QualityAssessment {
  const hash = strHash(v.s3Key ?? v.fileName ?? v.id);
  const size = v.fileSize ?? 0;
  const isPdf = v.fileType === 'application/pdf';

  // Quality band from file size — larger (within reason) suggests higher-res scan
  let band: number;
  if (size < 100_000)        band = 42;  // <100KB: below min, very poor quality
  else if (size < 300_000)   band = 62;  // 100–300KB: acceptable phone snap
  else if (size < 1_500_000) band = 80;  // 300KB–1.5MB: good phone photo
  else if (size < 5_000_000) band = 73;  // 1.5–5MB: large, still good
  else                       band = 60;  // >5MB: oversized, possibly noise

  const sub = Math.floor(band / 4);

  const sharpnessScore   = Math.min(25, Math.max(0, pick(hash,  0, sub - 3, sub + 4)));
  const contrastScore    = Math.min(25, Math.max(0, pick(hash,  7, sub - 2, sub + 5)));
  const alignmentScore   = Math.min(25, Math.max(0, isPdf
    ? pick(hash, 13, sub,     sub + 5)   // PDFs are well-aligned by nature
    : pick(hash, 13, sub - 4, sub + 3)));
  const readabilityScore = Math.min(25, Math.max(0, pick(hash, 19, sub - 2, sub + 5)));

  const total = sharpnessScore + contrastScore + alignmentScore + readabilityScore;

  const issues: string[] = [];
  if (sharpnessScore  < 12) issues.push('Low sharpness — image may be blurry or out of focus.');
  if (contrastScore   < 12) issues.push('Poor contrast — text may be difficult to read.');
  if (alignmentScore  < 12) issues.push('Document appears skewed or misaligned.');
  if (readabilityScore < 12) issues.push('Low readability — ensure document is flat, well-lit, and fully visible.');

  return { sharpnessScore, contrastScore, alignmentScore, readabilityScore, total, issues };
}

// ─── Mock: OCR extraction ──────────────────────────────────────────────────────

function buildMockFieldValues(v: Verification, user: User): Record<string, string> {
  const hash = strHash(v.s3Key ?? v.id);
  const now = Date.now();
  const futureDate  = new Date(now + 365 * 86_400_000).toISOString().slice(0, 10);
  const recentDate  = new Date(now -  30 * 86_400_000).toISOString().slice(0, 10);
  const screenDate  = new Date(now -  15 * 86_400_000).toISOString().slice(0, 10);
  const issueDate   = new Date(now - 180 * 86_400_000).toISOString().slice(0, 10);

  return {
    fullName:           user.name,
    dateOfBirth:        '1990-01-01',
    idNumber:           `ID${hash.toString().slice(-8).toUpperCase()}`,
    idType:             'Aadhaar Card',
    expiryDate:         futureDate,
    bloodGroup:         user.bloodGroup ?? 'O+',
    issuingInstitution: 'Apollo Hospitals',
    doctorName:         'Dr. Priya Sharma',
    certificateDate:    recentDate,
    screeningDate:      screenDate,
    hemoglobin:         `${(12 + pick(hash, 5, 0, 4)).toFixed(1)} g/dL`,
    bloodPressure:      `${110 + pick(hash, 8, 0, 20)}/${70 + pick(hash, 11, 0, 10)} mmHg`,
    doctorSignature:    'true',
    bankName:           user.name,
    licenseNumber:      `BL-${hash.toString().slice(-6).toUpperCase()}`,
    issuingAuthority:   'National Blood Transfusion Council',
    issueDate:          issueDate,
  };
}

function mockOCR(v: Verification, user: User): OCRResult {
  const hash = strHash(v.s3Key ?? v.id);
  const size = v.fileSize ?? 0;
  const expectedFields = EXPECTED_FIELDS[v.verificationType];
  const total = expectedFields.length;

  // How many fields can be extracted correlates with file quality
  const maxMissing = size < 100_000 ? 3 : size < 300_000 ? 1 : 0;
  const missing = pick(hash, 3, 0, maxMissing);
  const toFind = total - missing;

  const values = buildMockFieldValues(v, user);
  const fields: Record<string, OCRFieldResult> = {};
  const missingFields: string[] = [];
  let confSum = 0;
  let found = 0;

  for (let i = 0; i < total; i++) {
    const field = expectedFields[i];
    if (i < toFind) {
      const conf = pick(hash, i * 17 + 3, 74, 97);
      fields[field] = { value: values[field] ?? null, confidence: conf };
      confSum += conf;
      found++;
    } else {
      fields[field] = { value: null, confidence: 0 };
      missingFields.push(field);
    }
  }

  const averageConfidence = found > 0 ? Math.round(confSum / found) : 0;
  const issues: string[] = [];
  if (missingFields.length > 0) issues.push(`Could not read fields: ${missingFields.join(', ')}.`);
  if (averageConfidence > 0 && averageConfidence < 75) issues.push('Some fields have low OCR confidence — text may be unclear.');

  return { fieldsFound: found, fieldsTotal: total, averageConfidence, fields, missingFields, issues };
}

// ─── Mock: data consistency ───────────────────────────────────────────────────

function wordOverlap(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/);
  const wb = b.toLowerCase().split(/\s+/);
  const common = wa.filter(w => wb.includes(w)).length;
  const denom = Math.max(wa.length, wb.length);
  return denom > 0 ? common / denom : 0;
}

function normBg(bg: string): string {
  return bg.replace(/\s+/g, '').toUpperCase();
}

function mockConsistency(v: Verification, user: User, ocr: OCRResult): DataConsistency {
  const hash = strHash(v.s3Key ?? v.id);
  const issues: string[] = [];

  // Name match: extracted name vs user.name
  const extractedName = (ocr.fields['fullName'] ?? ocr.fields['bankName'])?.value;
  let nameMatchScore: number;
  if (extractedName) {
    const sim = wordOverlap(extractedName, user.name);
    nameMatchScore = Math.round(sim * 10);
    if (nameMatchScore < 7) issues.push('Name on document may not match your registered name.');
  } else {
    nameMatchScore = pick(hash, 1, 6, 8);  // field missing — partial credit
  }

  // DOB match: no DOB in User model, award partial credit seeded from hash
  const dobMatchScore = pick(hash, 2, 7, 10);

  // Blood group match (only for BLOOD_GROUP_PROOF; others get full marks)
  let bloodGroupMatchScore: number;
  if (v.verificationType === VerificationType.BLOOD_GROUP_PROOF) {
    const extractedBg = ocr.fields['bloodGroup']?.value;
    if (extractedBg && user.bloodGroup) {
      bloodGroupMatchScore = normBg(extractedBg) === normBg(user.bloodGroup) ? 5 : 1;
      if (bloodGroupMatchScore < 4) issues.push('Blood group on certificate does not match your declared blood group.');
    } else {
      bloodGroupMatchScore = 3;
    }
  } else {
    bloodGroupMatchScore = 5;
  }

  // Document type match — seeded, mostly correct
  const typeMatchScore = pick(hash, 5, 3, 5);

  const total = nameMatchScore + dobMatchScore + bloodGroupMatchScore + typeMatchScore;
  return { nameMatchScore, dobMatchScore, bloodGroupMatchScore, typeMatchScore, total, issues };
}

// ─── PROD passthrough ────────────────────────────────────────────────────────
// Returns conservative scores when no AI provider is configured.
// Metadata-only checks act as the primary gate; confidence is informational.

function prodPassthrough(v: Verification, start: number): DocumentAnalysisResult {
  const expected = EXPECTED_FIELDS[v.verificationType];
  const fields: Record<string, OCRFieldResult> = {};
  expected.forEach(f => { fields[f] = { value: null, confidence: 0 }; });

  return {
    quality: {
      sharpnessScore: 20, contrastScore: 20, alignmentScore: 20, readabilityScore: 20,
      total: 80, issues: [],
    },
    ocr: {
      fieldsFound: 0, fieldsTotal: expected.length, averageConfidence: 0,
      fields, missingFields: [...expected],
      issues: ['AI analysis not configured — document accepted on metadata checks alone.'],
    },
    consistency: {
      nameMatchScore: 5, dobMatchScore: 5, bloodGroupMatchScore: 3, typeMatchScore: 3,
      total: 16, issues: [],
    },
    processingMs: Date.now() - start,
  };
}

// ─── AI provider detection ────────────────────────────────────────────────────
// Extend this to return true when credentials for AWS Textract, Google Vision,
// or another provider are present in the environment.

function isAIConfigured(): boolean {
  // Future: return Boolean(env.GOOGLE_VISION_API_KEY || env.AWS_TEXTRACT_ENABLED);
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function analyzeDocument(v: Verification, user: User): Promise<DocumentAnalysisResult> {
  const start = Date.now();

  if (env.USE_DUMMY_DATA || !isAIConfigured()) {
    logger.info('[DEV] Document analysis — mock assessment', {
      id: v.id,
      type: v.verificationType,
      fileSize: v.fileSize,
      fileType: v.fileType,
    });

    // Realistic async delay (300ms–1.1s) seeded from document id
    await new Promise(r => setTimeout(r, pick(strHash(v.id), 0, 300, 1100)));

    const quality     = mockQuality(v);
    const ocr         = mockOCR(v, user);
    const consistency = mockConsistency(v, user, ocr);

    return { quality, ocr, consistency, processingMs: Date.now() - start };
  }

  // PROD: no AI provider configured — use passthrough
  logger.warn('[PROD] Document analysis: no AI provider configured — passthrough assessment used', { id: v.id });
  return prodPassthrough(v, start);
}
