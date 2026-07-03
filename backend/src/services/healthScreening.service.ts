import { prisma } from '../config/database';
import { HealthScreeningInput } from '../types/eligibility.types';
import { checkEligibility } from './eligibility.service';

const MIN_WEIGHT_KG       = 50;
const MIN_HEMOGLOBIN_GDL  = 12.5;
const MIN_SYSTOLIC_BP     = 90;
const MAX_SYSTOLIC_BP     = 180;
const MIN_DIASTOLIC_BP    = 60;
const MAX_DIASTOLIC_BP    = 100;

function computeScreeningResult(input: HealthScreeningInput): {
  screeningPassed: boolean;
  disqualifyingFactors: string[];
  weightMeetsMinimum: boolean;
  bmi: number | null;
} {
  const factors: string[] = [];

  // Permanent disqualifying conditions
  if (input.hasHeartDisease)      factors.push('Heart disease');
  if (input.hasHepatitis)         factors.push('Hepatitis');
  if (input.hasHiv)               factors.push('HIV/AIDS');
  if (input.hasTuberculosis)      factors.push('Active tuberculosis');
  if (input.hasCancer)            factors.push('Cancer');
  if (input.hasBleedingDisorder)  factors.push('Bleeding or clotting disorder');
  if (input.hasKidneyDisease)     factors.push('Severe kidney disease');
  if (input.hasLiverDisease)      factors.push('Severe liver disease');
  if (input.isPregnant)           factors.push('Currently pregnant');
  if (input.hasFever)             factors.push('Active fever');

  // Physical checks
  const weightMeetsMinimum = input.weight !== undefined ? input.weight >= MIN_WEIGHT_KG : true;
  if (input.weight !== undefined && input.weight < MIN_WEIGHT_KG) {
    factors.push(`Weight below minimum (${input.weight} kg < ${MIN_WEIGHT_KG} kg)`);
  }
  if (input.hemoglobinLevel !== undefined && input.hemoglobinLevel < MIN_HEMOGLOBIN_GDL) {
    factors.push(`Hemoglobin below minimum (${input.hemoglobinLevel} g/dL < ${MIN_HEMOGLOBIN_GDL} g/dL)`);
  }

  // Blood pressure
  if (input.bloodPressure) {
    const [sys, dia] = input.bloodPressure.split('/').map(Number);
    if (!isNaN(sys) && !isNaN(dia)) {
      if (sys < MIN_SYSTOLIC_BP || sys > MAX_SYSTOLIC_BP || dia < MIN_DIASTOLIC_BP || dia > MAX_DIASTOLIC_BP) {
        factors.push(`Blood pressure out of safe range (${input.bloodPressure})`);
      }
    }
  }

  // Compute BMI
  let bmi: number | null = null;
  if (input.height && input.weight) {
    bmi = Math.round((input.weight / Math.pow(input.height / 100, 2)) * 10) / 10;
  }

  return {
    screeningPassed: factors.length === 0,
    disqualifyingFactors: factors,
    weightMeetsMinimum,
    bmi,
  };
}

// ─── Temporary deferral from screening input ──────────────────────────────────
// Mirrors eligibility.service.ts Stage 4d but works on the raw HealthScreeningInput
// instead of the DB record. Used so we can persist DEFERRED immediately even when
// checkEligibility short-circuits at Stage 2 (missing medical verification document)
// before ever reaching Stage 4d.
function computeTemporaryDeferral(input: HealthScreeningInput): {
  deferred: boolean;
  deferralReason: string | null;
  nextEligibleDate: Date | null;
} {
  const now = new Date();
  let deferralEnd: Date | undefined;
  let firstReason: string | undefined;

  const addDeferral = (clearDate: Date, reason: string) => {
    if (clearDate > now) {
      if (!firstReason) firstReason = reason;
      if (!deferralEnd || clearDate > deferralEnd) deferralEnd = clearDate;
    }
  };

  if (input.hasConsumedAlcohol24h) {
    addDeferral(new Date(now.getTime() + 24 * 3_600_000),
      'Alcohol consumed within the last 24 hours — please wait 24 hours.');
  }
  if (input.hasRecentSurgery && input.recentSurgeryDate) {
    const d = new Date(input.recentSurgeryDate);
    d.setDate(d.getDate() + 180);
    addDeferral(d, 'Recent surgery — must wait 6 months from surgery date.');
  }
  if (input.hasRecentTattoo && input.recentTattooDate) {
    const d = new Date(input.recentTattooDate);
    d.setDate(d.getDate() + 180);
    addDeferral(d, 'Recent tattoo — must wait 6 months from tattoo date.');
  }
  if (input.hasRecentPiercing && input.recentPiercingDate) {
    const d = new Date(input.recentPiercingDate);
    d.setDate(d.getDate() + 180);
    addDeferral(d, 'Recent piercing — must wait 6 months from piercing date.');
  }
  if (input.hasRecentVaccination && input.recentVaccinationDate) {
    const d = new Date(input.recentVaccinationDate);
    d.setDate(d.getDate() + 14);
    addDeferral(d, 'Recent vaccination — must wait 2 weeks from vaccination date.');
  }
  if (input.isPregnant) {
    addDeferral(new Date(now.getTime() + 180 * 86_400_000),
      'Currently pregnant — deferral until 6 months after delivery.');
  } else if (input.isBreastfeeding) {
    addDeferral(new Date(now.getTime() + 180 * 86_400_000),
      'Currently breastfeeding — deferral until 6 months after stopping.');
  }
  if (input.hasRecentTravel && input.recentTravelCountry) {
    // Approximate: deferral starts from today (the screening submission date)
    addDeferral(new Date(now.getTime() + 90 * 86_400_000),
      `Recent travel to ${input.recentTravelCountry} — 3-month deferral applies.`);
  }

  return {
    deferred:        !!deferralEnd,
    deferralReason:  firstReason ?? null,
    nextEligibleDate: deferralEnd ?? null,
  };
}

export async function submitHealthScreening(userId: string, input: HealthScreeningInput) {
  const { screeningPassed, disqualifyingFactors, weightMeetsMinimum, bmi } = computeScreeningResult(input);

  const screening = await prisma.healthScreening.upsert({
    where: { userId },
    create: {
      userId,
      ...input,
      recentSurgeryDate:     input.recentSurgeryDate     ? new Date(input.recentSurgeryDate)     : undefined,
      recentTattooDate:      input.recentTattooDate      ? new Date(input.recentTattooDate)      : undefined,
      recentPiercingDate:    input.recentPiercingDate    ? new Date(input.recentPiercingDate)    : undefined,
      recentVaccinationDate: input.recentVaccinationDate ? new Date(input.recentVaccinationDate) : undefined,
      bmi: bmi ?? undefined,
      weightMeetsMinimum,
      screeningPassed,
      disqualifyingFactors: disqualifyingFactors.length > 0 ? JSON.stringify(disqualifyingFactors) : null,
      screeningDate: new Date(),
    },
    update: {
      ...input,
      recentSurgeryDate:     input.recentSurgeryDate     ? new Date(input.recentSurgeryDate)     : null,
      recentTattooDate:      input.recentTattooDate      ? new Date(input.recentTattooDate)      : null,
      recentPiercingDate:    input.recentPiercingDate    ? new Date(input.recentPiercingDate)    : null,
      recentVaccinationDate: input.recentVaccinationDate ? new Date(input.recentVaccinationDate) : null,
      bmi: bmi ?? null,
      weightMeetsMinimum,
      screeningPassed,
      disqualifyingFactors: disqualifyingFactors.length > 0 ? JSON.stringify(disqualifyingFactors) : null,
      screeningDate: new Date(),
    },
  });

  console.log('[HealthScreening] submitHealthScreening — hasConsumedAlcohol24h:', input.hasConsumedAlcohol24h,
    '| screeningPassed:', screeningPassed,
    '| disqualifyingFactors:', disqualifyingFactors);

  // Run full eligibility check and persist the result so Phase 5 returns
  // the correct donorStatus immediately (without waiting for its 24-hour cache).
  const eligibility = await checkEligibility(userId);
  console.log('[HealthScreening] checkEligibility result — eligible:', eligibility.eligible,
    '| nextEligibleDate:', eligibility.nextEligibleDate?.toISOString() ?? 'null',
    '| disqualifyingFactors:', eligibility.disqualifyingFactors ?? [],
    '| needsMedicalScreening:', (eligibility as any).needsMedicalScreening ?? false);

  if (eligibility.eligible && eligibility.eligibilityExpiry) {
    // All screening checks passed — eligible to register as donor.
    await prisma.user.update({
      where: { id: userId },
      data: {
        isDonorEligible:         true,
        donorEligibleSince:      new Date(),
        donorEligibilityExpiry:  eligibility.eligibilityExpiry,
        donorVerificationStatus: 'ELIGIBLE',
        donorStatus:             'PENDING_REVIEW',
        deferralDate:            null,
        deferralReason:          null,
        nextEligibleDate:        null,
        eligibilityCheckedAt:    new Date(),
      },
    });
  } else if (
    !eligibility.eligible &&
    eligibility.disqualifyingFactors &&
    eligibility.disqualifyingFactors.length > 0
  ) {
    // Permanent medical disqualification (heart disease, HIV, etc.).
    await prisma.user.update({
      where: { id: userId },
      data: {
        isDonorEligible:         false,
        donorEligibleSince:      null,
        donorEligibilityExpiry:  null,
        donorStatus:             'INELIGIBLE',
        deferralDate:            new Date(),
        deferralReason:          eligibility.disqualifyingFactors.join('; '),
        nextEligibleDate:        null,
        eligibilityCheckedAt:    new Date(),
      },
    });
  } else if (!eligibility.eligible && eligibility.nextEligibleDate) {
    // Temporary deferral detected by checkEligibility (e.g. donation cooldown from Stage 1,
    // or screening factors when the user already has a verified medical document).
    await prisma.user.update({
      where: { id: userId },
      data: {
        isDonorEligible:         false,
        donorEligibleSince:      null,
        donorEligibilityExpiry:  null,
        donorStatus:             'DEFERRED',
        deferralDate:            new Date(),
        deferralReason:          eligibility.reasons[0] ?? 'Temporary deferral',
        nextEligibleDate:        eligibility.nextEligibleDate,
        eligibilityCheckedAt:    new Date(),
      },
    });
  } else {
    // checkEligibility short-circuited before Stage 4d (e.g. no medical verification
    // document yet), so it never evaluated alcohol/surgery/tattoo/etc. deferrals.
    // Compute those directly from the form input and persist DEFERRED if found.
    const deferral = computeTemporaryDeferral(input);
    console.log('[HealthScreening] computeTemporaryDeferral result — deferred:', deferral.deferred,
      '| reason:', deferral.deferralReason,
      '| nextEligibleDate:', deferral.nextEligibleDate?.toISOString() ?? 'null');
    if (deferral.deferred && deferral.nextEligibleDate) {
      console.log('[HealthScreening] Persisting DEFERRED from input (checkEligibility did not reach Stage 4d):', deferral.deferralReason);
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          isDonorEligible:         false,
          donorEligibleSince:      null,
          donorEligibilityExpiry:  null,
          donorStatus:             'DEFERRED',
          deferralDate:            new Date(),
          deferralReason:          deferral.deferralReason,
          nextEligibleDate:        deferral.nextEligibleDate,
          eligibilityCheckedAt:    new Date(),
        },
        select: { donorStatus: true, deferralReason: true, nextEligibleDate: true, eligibilityCheckedAt: true },
      });
      console.log('[HealthScreening] DB updated — donorStatus:', updated.donorStatus,
        '| deferralReason:', updated.deferralReason,
        '| nextEligibleDate:', updated.nextEligibleDate?.toISOString() ?? 'null',
        '| eligibilityCheckedAt:', updated.eligibilityCheckedAt?.toISOString() ?? 'null');
    } else {
      // Still ineligible for unresolved reasons (e.g. missing docs still outstanding).
      // Clear stale eligibility flags and force Phase 5 to recompute on the next call.
      console.log('[HealthScreening] No temporary deferral found from input — clearing eligibilityCheckedAt to force Phase 5 recompute');
      await prisma.user.update({
        where: { id: userId },
        data: {
          isDonorEligible:         false,
          donorEligibleSince:      null,
          donorEligibilityExpiry:  null,
          eligibilityCheckedAt:    null,
        },
      });
    }
  }

  return { screening, eligibility };
}
