import { VerificationType, VerificationStatus } from '@prisma/client';
import { prisma } from '../config/database';
import {
  EligibilityResult,
  EligibilityStatusResponse,
  DocumentStatusResponse,
} from '../types/eligibility.types';
import { DONATION_COOLDOWN_DAYS } from '../utils/constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const MEDICAL_SCREENING_VALIDITY_DAYS = 180;   // 6 months
const ELIGIBILITY_EXPIRY_MONTHS        = 6;
const MIN_WEIGHT_KG                    = 50;
const MIN_HEMOGLOBIN_GDL               = 12.5;
const MIN_SYSTOLIC_BP                  = 90;
const MAX_SYSTOLIC_BP                  = 180;
const MIN_DIASTOLIC_BP                 = 60;
const MAX_DIASTOLIC_BP                 = 100;
const VACCINE_DEFERRAL_DAYS            = 14;
const TRAVEL_DEFERRAL_DAYS             = 90;
const PROCEDURE_DEFERRAL_DAYS          = 180;  // surgery, tattoo, piercing

// ─── Core eligibility check ───────────────────────────────────────────────────

export async function checkEligibility(userId: string): Promise<EligibilityResult> {
  const reasons: string[] = [];
  const disqualifyingFactors: string[] = [];

  // ── Stage 1: Donation cooldown ────────────────────────────────────────────
  const lastDonation = await prisma.donation.findFirst({
    where: { donorId: userId, isVerified: true },
    orderBy: { donationDate: 'desc' },
  });

  if (lastDonation) {
    const nextEligible = new Date(lastDonation.donationDate);
    nextEligible.setDate(nextEligible.getDate() + DONATION_COOLDOWN_DAYS);
    if (nextEligible > new Date()) {
      const daysLeft = Math.ceil((nextEligible.getTime() - Date.now()) / 86_400_000);
      return {
        eligible: false,
        reasons: [`You must wait ${DONATION_COOLDOWN_DAYS} days between blood donations (${daysLeft} days remaining).`],
        nextEligibleDate: nextEligible,
        suggestReminder: true,
      };
    }
  }

  // ── Stage 2: Medical screening verification ───────────────────────────────
  const medVerification = await prisma.verification.findFirst({
    where: {
      userId,
      verificationType: VerificationType.MEDICAL_SCREENING,
      status: VerificationStatus.VERIFIED,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!medVerification) {
    return {
      eligible: false,
      reasons: ['A verified medical screening document is required before you can become a donor.'],
      needsMedicalScreening: true,
    };
  }

  const medAgeDays = (Date.now() - medVerification.updatedAt.getTime()) / 86_400_000;
  if (medAgeDays > MEDICAL_SCREENING_VALIDITY_DAYS) {
    return {
      eligible: false,
      reasons: ['Your medical screening has expired (valid for 6 months). Please submit a new one.'],
      needsMedicalScreening: true,
    };
  }

  // ── Stage 3: Health screening questionnaire ───────────────────────────────
  const hs = await prisma.healthScreening.findUnique({ where: { userId } });

  if (!hs) {
    return {
      eligible: false,
      reasons: ['You must complete the health screening questionnaire before becoming a donor.'],
      needsHealthScreening: true,
    };
  }

  // ── Stage 4: Evaluate health screening responses ──────────────────────────

  // 4a — Permanent disqualifications
  if (hs.hasHeartDisease)     disqualifyingFactors.push('Heart disease');
  if (hs.hasHepatitis)        disqualifyingFactors.push('Hepatitis');
  if (hs.hasHiv)              disqualifyingFactors.push('HIV/AIDS');
  if (hs.hasTuberculosis)     disqualifyingFactors.push('Active tuberculosis');
  if (hs.hasCancer)           disqualifyingFactors.push('Cancer (currently under treatment)');
  if (hs.hasBleedingDisorder) disqualifyingFactors.push('Bleeding or clotting disorder');
  if (hs.hasKidneyDisease)    disqualifyingFactors.push('Severe kidney disease');
  if (hs.hasLiverDisease)     disqualifyingFactors.push('Severe liver disease');

  // 4b — Physical requirements
  if (hs.weight !== null && hs.weight !== undefined && hs.weight < MIN_WEIGHT_KG) {
    disqualifyingFactors.push(`Weight too low (${hs.weight} kg — minimum is ${MIN_WEIGHT_KG} kg)`);
  }
  if (hs.hemoglobinLevel !== null && hs.hemoglobinLevel !== undefined && hs.hemoglobinLevel < MIN_HEMOGLOBIN_GDL) {
    disqualifyingFactors.push(`Hemoglobin too low (${hs.hemoglobinLevel} g/dL — minimum is ${MIN_HEMOGLOBIN_GDL} g/dL)`);
  }
  if (hs.hasFever) {
    disqualifyingFactors.push('Currently has fever');
  }

  // 4c — Blood pressure (parse "systolic/diastolic")
  if (hs.bloodPressure) {
    const [sys, dia] = hs.bloodPressure.split('/').map(Number);
    if (!isNaN(sys) && !isNaN(dia)) {
      if (sys < MIN_SYSTOLIC_BP || sys > MAX_SYSTOLIC_BP || dia < MIN_DIASTOLIC_BP || dia > MAX_DIASTOLIC_BP) {
        disqualifyingFactors.push(`Blood pressure out of range (${hs.bloodPressure} — acceptable: ${MIN_SYSTOLIC_BP}–${MAX_SYSTOLIC_BP}/${MIN_DIASTOLIC_BP}–${MAX_DIASTOLIC_BP})`);
      }
    }
  }

  if (disqualifyingFactors.length > 0) {
    return {
      eligible: false,
      reasons: disqualifyingFactors.map(f => `Disqualifying condition: ${f}`),
      disqualifyingFactors,
    };
  }

  // 4d — Temporary deferrals (collect the furthest future date)
  let deferralEnd: Date | undefined;
  const now = new Date();

  const addDeferral = (clearDate: Date, reason: string) => {
    if (clearDate > now) {
      reasons.push(reason);
      if (!deferralEnd || clearDate > deferralEnd) deferralEnd = clearDate;
    }
  };

  if (hs.hasRecentSurgery && hs.recentSurgeryDate) {
    const d = new Date(hs.recentSurgeryDate);
    d.setDate(d.getDate() + PROCEDURE_DEFERRAL_DAYS);
    addDeferral(d, 'Recent surgery — must wait 6 months from surgery date.');
  }
  if (hs.hasRecentTattoo && hs.recentTattooDate) {
    const d = new Date(hs.recentTattooDate);
    d.setDate(d.getDate() + PROCEDURE_DEFERRAL_DAYS);
    addDeferral(d, 'Recent tattoo — must wait 6 months from tattoo date.');
  }
  if (hs.hasRecentPiercing && hs.recentPiercingDate) {
    const d = new Date(hs.recentPiercingDate);
    d.setDate(d.getDate() + PROCEDURE_DEFERRAL_DAYS);
    addDeferral(d, 'Recent piercing — must wait 6 months from piercing date.');
  }
  if (hs.hasRecentVaccination && hs.recentVaccinationDate) {
    const d = new Date(hs.recentVaccinationDate);
    d.setDate(d.getDate() + VACCINE_DEFERRAL_DAYS);
    addDeferral(d, 'Recent vaccination — must wait 2 weeks from vaccination date.');
  }
  if (hs.hasConsumedAlcohol24h) {
    const d = new Date(now.getTime() + 24 * 3_600_000);
    addDeferral(d, 'Alcohol consumed within the last 24 hours — please wait 24 hours.');
  }
  if (hs.isPregnant) {
    const d = new Date(now.getTime() + 180 * 86_400_000);
    addDeferral(d, 'Currently pregnant — deferral until 6 months after delivery.');
  } else if (hs.isBreastfeeding) {
    const d = new Date(now.getTime() + 180 * 86_400_000);
    addDeferral(d, 'Currently breastfeeding — deferral until 6 months after stopping.');
  }
  if (hs.hasRecentTravel && hs.recentTravelCountry) {
    const d = new Date(hs.screeningDate);
    d.setDate(d.getDate() + TRAVEL_DEFERRAL_DAYS);
    addDeferral(d, `Recent travel to ${hs.recentTravelCountry} — 3-month deferral applies.`);
  }

  if (deferralEnd) {
    return {
      eligible: false,
      reasons,
      nextEligibleDate: deferralEnd,
      suggestReminder: true,
    };
  }

  // ── Stage 5: BMI (informational warning, not a hard gate) ────────────────
  const bmiWarnings: string[] = [];
  if (hs.height && hs.weight) {
    const bmi = hs.weight / Math.pow(hs.height / 100, 2);
    if (bmi < 18.5 || bmi > 35) {
      bmiWarnings.push(`BMI ${bmi.toFixed(1)} is outside the recommended range (18.5–35). Please consult a doctor.`);
    }
  }

  // ── Stage 6: All checks passed ────────────────────────────────────────────
  const eligibilityExpiry = new Date();
  eligibilityExpiry.setMonth(eligibilityExpiry.getMonth() + ELIGIBILITY_EXPIRY_MONTHS);

  return {
    eligible: true,
    reasons: bmiWarnings,
    screeningDate: hs.screeningDate,
    eligibilityExpiry,
  };
}

// ─── Eligibility status dashboard ────────────────────────────────────────────

export async function getEligibilityStatus(userId: string): Promise<EligibilityStatusResponse> {
  const [user, lastDonation, medVerification, hs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { isDonorEligible: true, donorEligibleSince: true, donorEligibilityExpiry: true },
    }),
    prisma.donation.findFirst({
      where: { donorId: userId, isVerified: true },
      orderBy: { donationDate: 'desc' },
    }),
    prisma.verification.findFirst({
      where: { userId, verificationType: VerificationType.MEDICAL_SCREENING, status: VerificationStatus.VERIFIED },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.healthScreening.findUnique({ where: { userId } }),
  ]);

  // Cooldown section
  let onCooldown = false;
  let cooldownNext: string | null = null;
  let daysSince: number | null = null;

  if (lastDonation) {
    daysSince = Math.floor((Date.now() - lastDonation.donationDate.getTime()) / 86_400_000);
    const next = new Date(lastDonation.donationDate);
    next.setDate(next.getDate() + DONATION_COOLDOWN_DAYS);
    if (next > new Date()) {
      onCooldown = true;
      cooldownNext = next.toISOString();
    }
  }

  // Medical screening expiry
  let medVerified = false;
  let medExpiry: string | null = null;
  if (medVerification) {
    const expiry = new Date(medVerification.updatedAt);
    expiry.setDate(expiry.getDate() + MEDICAL_SCREENING_VALIDITY_DAYS);
    medVerified = expiry > new Date();
    medExpiry = expiry.toISOString();
  }

  return {
    eligible: user?.isDonorEligible ?? false,
    lastChecked: new Date().toISOString(),
    eligibilityExpiry: user?.donorEligibilityExpiry?.toISOString() ?? null,
    donationCooldown: {
      onCooldown,
      lastDonationDate: lastDonation?.donationDate.toISOString() ?? null,
      daysSinceLastDonation: daysSince,
      nextEligibleDate: cooldownNext,
    },
    medicalScreening: {
      verified: medVerified,
      expiryDate: medExpiry,
    },
    healthScreening: {
      completed: !!hs,
      passed: hs?.screeningPassed ?? null,
      date: hs?.screeningDate.toISOString() ?? null,
    },
  };
}

// ─── Document status ──────────────────────────────────────────────────────────

export async function getDocumentStatus(userId: string): Promise<DocumentStatusResponse> {
  const sixMonthsAgo = new Date(Date.now() - MEDICAL_SCREENING_VALIDITY_DAYS * 86_400_000);

  const [idProof, bloodGroupProof, medScreening] = await Promise.all([
    prisma.verification.findFirst({
      where: { userId, verificationType: VerificationType.ID_PROOF, status: VerificationStatus.VERIFIED },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.verification.findFirst({
      where: { userId, verificationType: VerificationType.BLOOD_GROUP_PROOF, status: VerificationStatus.VERIFIED },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.verification.findFirst({
      where: {
        userId,
        verificationType: VerificationType.MEDICAL_SCREENING,
        status: VerificationStatus.VERIFIED,
        updatedAt: { gte: sixMonthsAgo },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const now = new Date();
  const idValid  = idProof  && (!idProof.expiresAt  || idProof.expiresAt > now);
  const bgValid  = bloodGroupProof && (!bloodGroupProof.expiresAt || bloodGroupProof.expiresAt > now);
  const medValid = !!medScreening;

  const needsDocuments: string[] = [];
  if (!idValid)  needsDocuments.push('ID_PROOF');
  if (!bgValid)  needsDocuments.push('BLOOD_GROUP_PROOF');
  if (!medValid) needsDocuments.push('MEDICAL_SCREENING');

  const existingDocuments: DocumentStatusResponse['existingDocuments'] = {};
  if (idValid && idProof) {
    existingDocuments.idProof = { id: idProof.id, verified: true, expiryDate: idProof.expiresAt?.toISOString() ?? null };
  }
  if (bgValid && bloodGroupProof) {
    existingDocuments.bloodGroupProof = { id: bloodGroupProof.id, verified: true, expiryDate: bloodGroupProof.expiresAt?.toISOString() ?? null };
  }
  if (medValid && medScreening) {
    const exp = new Date(medScreening.updatedAt);
    exp.setDate(exp.getDate() + MEDICAL_SCREENING_VALIDITY_DAYS);
    existingDocuments.medicalScreening = { id: medScreening.id, verified: true, expiryDate: exp.toISOString() };
  }

  return {
    documentsAvailable: needsDocuments.length === 0,
    existingDocuments,
    needsDocuments,
    canProceed: needsDocuments.length === 0,
  };
}
