/**
 * Confidence Score Service
 *
 * Computes a multi-factor confidence score (0-100) from document analysis and
 * metadata check results. The breakdown is stored in autoCheckResults so admins
 * and auditors can see exactly why a document was approved or rejected.
 *
 * Weighting:
 *   Document Quality   25%  (image sharpness, contrast, alignment, readability)
 *   OCR Extraction     35%  (fields found, average field confidence)
 *   Data Consistency   30%  (name/DOB/blood-group match against user profile)
 *   Security Checks    10%  (uniqueness, fraud indicators)
 */

import { DocumentAnalysisResult } from './documentAnalysis.service';
import { AutoCheckResult, ConfidenceBreakdown } from '../types/verification.types';

export function computeConfidenceScore(
  analysis: DocumentAnalysisResult,
  checkResults: AutoCheckResult[],
  fraudIndicators: string[],
): ConfidenceBreakdown {

  // ── Factor 1: Document Quality (max 25) ──────────────────────────────────
  // analysis.quality.total is already the sum of 4 sub-scores each 0-25 → total 0-100.
  // Scale to 0-25 by dividing by 4.
  const qualityScore = Math.min(25, Math.round(analysis.quality.total / 4));

  // ── Factor 2: OCR Extraction (max 35) ────────────────────────────────────
  // Completeness (found/total) × 20 + average field confidence × 0.15
  const { fieldsFound, fieldsTotal, averageConfidence } = analysis.ocr;
  const completeness = fieldsTotal > 0 ? fieldsFound / fieldsTotal : 0;
  const ocrScore = Math.min(35, Math.round(completeness * 20 + (averageConfidence / 100) * 15));

  // ── Factor 3: Data Consistency (max 30) ──────────────────────────────────
  const consistencyScore = Math.min(30, analysis.consistency.total);

  // ── Factor 4: Security Checks (max 10) ───────────────────────────────────
  const isDuplicate = fraudIndicators.includes('DUPLICATE_DOCUMENT');
  const fraudPenalty = Math.min(8, fraudIndicators.length * 2);
  const securityScore = Math.max(0, 10 - fraudPenalty - (isDuplicate ? 5 : 0));

  const totalConfidence = Math.min(100, qualityScore + ocrScore + consistencyScore + securityScore);

  // ── Recommended action ────────────────────────────────────────────────────
  const failedCount = checkResults.filter(r => !r.passed).length;
  let action: string;
  if (failedCount > 0) {
    action = `${failedCount} metadata check(s) failed — document rejected`;
  } else if (totalConfidence >= 85) {
    action = 'High confidence — automated approval';
  } else if (totalConfidence >= 70) {
    action = 'Good confidence — document accepted';
  } else if (totalConfidence >= 60) {
    action = 'Moderate confidence — accepted, quality could be improved';
  } else {
    action = 'Low confidence — poor quality or data mismatch';
  }

  const securityIssues: string[] = [];
  if (isDuplicate) securityIssues.push('Document has been submitted by another user.');
  if (fraudIndicators.length > 1) securityIssues.push(`${fraudIndicators.length} fraud indicators detected.`);

  return {
    totalConfidence,

    documentQuality: {
      score: qualityScore,
      maxScore: 25,
      details: {
        sharpness:   analysis.quality.sharpnessScore,
        contrast:    analysis.quality.contrastScore,
        alignment:   analysis.quality.alignmentScore,
        readability: analysis.quality.readabilityScore,
      },
      issues: analysis.quality.issues,
    },

    ocrExtraction: {
      score: ocrScore,
      maxScore: 35,
      details: {
        fieldsExtracted:        `${fieldsFound}/${fieldsTotal}`,
        averageFieldConfidence: averageConfidence,
        missingFields:          analysis.ocr.missingFields,
      },
      issues: analysis.ocr.issues,
    },

    dataConsistency: {
      score: consistencyScore,
      maxScore: 30,
      details: {
        nameMatch:         analysis.consistency.nameMatchScore,
        dobMatch:          analysis.consistency.dobMatchScore,
        bloodGroupMatch:   analysis.consistency.bloodGroupMatchScore,
        documentTypeMatch: analysis.consistency.typeMatchScore,
      },
      issues: analysis.consistency.issues,
    },

    securityChecks: {
      score: securityScore,
      maxScore: 10,
      details: {
        isUnique:           !isDuplicate,
        tamperingDetected:  false,  // reserved for PROD AI tamper detection
        fraudFlagCount:     fraudIndicators.length,
      },
      issues: securityIssues,
    },

    recommendedAction: action,
    processingTimeMs: analysis.processingMs,
  };
}
