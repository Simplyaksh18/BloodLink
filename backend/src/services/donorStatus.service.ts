import { DonorStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { checkEligibility } from './eligibility.service';
import { DONATION_COOLDOWN_DAYS } from '../utils/constants';

const STATUS_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Dev-only force-active override ──────────────────────────────────────────
// In-memory Set of userIds that have been force-activated via /dev/donor/force-active.
// Never populated in production. Resets on server restart (acceptable for dev QA).
// Bypasses the donation-cooldown guard so force-active persists even when
// lastDonationDate is recent, without erasing donation history.
const _devForceActiveIds = new Set<string>();

export function setDevForceActive(userId: string): void {
  if (process.env.NODE_ENV === 'production') return;
  _devForceActiveIds.add(userId);
}

export function clearDevForceActive(userId: string): void {
  _devForceActiveIds.delete(userId);
}

function isDevForceActive(userId: string): boolean {
  return process.env.NODE_ENV !== 'production' && _devForceActiveIds.has(userId);
}

export interface DonorStatusResult {
  donorStatus: DonorStatus;
  isEligible: boolean;
  nextEligibleDate: string | null;
  daysRemaining: number | null;
  deferralDate: string | null;
  deferralReason: string | null;
  totalDonations: number;
  lastDonationDate: string | null;
  reminderSet: boolean;
  canBecomeDonor: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

async function persistStatus(
  userId: string,
  donorStatus: DonorStatus,
  extra: {
    deferralDate?: Date | null;
    deferralReason?: string | null;
    nextEligibleDate?: Date | null;
  } = {}
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      donorStatus,
      isDonorEligible:      donorStatus === 'ACTIVE',
      deferralDate:         extra.deferralDate ?? null,
      deferralReason:       extra.deferralReason ?? null,
      nextEligibleDate:     extra.nextEligibleDate ?? null,
      eligibilityCheckedAt: new Date(),
    },
  });
}

async function buildResult(userId: string): Promise<DonorStatusResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      donorStatus:     true,
      deferralDate:    true,
      deferralReason:  true,
      nextEligibleDate: true,
      reminderSet:     true,
      isDonorEligible: true,
      totalDonations:  true,
      lastDonationDate: true,
    },
  });
  if (!user) throw new Error('User not found');

  const days = daysUntil(user.nextEligibleDate);
  const hasActiveDeferral = !!user.nextEligibleDate && user.nextEligibleDate > new Date();
  // An established donor (has donation history) can never become a donor again via registration —
  // they already are one. Guard against the DB donorStatus being stale/incorrect.
  const hasEstablishedHistory = user.totalDonations > 0 || !!user.lastDonationDate;
  const canBecomeDonor =
    user.donorStatus === 'NEVER_DONATED' &&
    !hasActiveDeferral &&
    !user.deferralReason &&
    !hasEstablishedHistory;

  console.log('[DonorStatus] buildResult:', user.donorStatus,
    '| totalDonations:', user.totalDonations,
    '| lastDonationDate:', user.lastDonationDate?.toISOString() ?? 'null',
    '| hasEstablishedHistory:', hasEstablishedHistory,
    '| canBecomeDonor:', canBecomeDonor);

  return {
    donorStatus:      user.donorStatus,
    isEligible:       user.donorStatus === 'ACTIVE' && user.isDonorEligible === true,
    nextEligibleDate: user.nextEligibleDate?.toISOString() ?? null,
    daysRemaining:    days,
    deferralDate:     user.deferralDate?.toISOString() ?? null,
    deferralReason:   user.deferralReason,
    totalDonations:   user.totalDonations,
    lastDonationDate: user.lastDonationDate?.toISOString() ?? null,
    reminderSet:      user.reminderSet,
    canBecomeDonor,
  };
}

// ─── Sync donorStatus/isDonorEligible from verified documents ─────────────────
// Required-document verification (idVerified/bloodGroupVerified/medicalVerified)
// is tracked independently of the HealthScreening questionnaire used by
// checkEligibility(). This is the single source of truth for promoting a donor
// once all three documents are VERIFIED — called both immediately after a
// verification-status change and as a self-healing fallback from
// computeDonorStatus() when those flags are already true but donorStatus/
// isDonorEligible are stale (e.g. from a promotion that never ran).
// Returns true if it wrote a status (ACTIVE or DEFERRED), false if the
// required documents aren't all verified yet (caller should fall back to
// other eligibility logic).
export async function syncDonorEligibilityFromDocuments(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      idVerified: true,
      bloodGroupVerified: true,
      medicalVerified: true,
      nextEligibleDate: true,
      lastDonationDate: true,
    },
  });
  if (!user) return false;

  const allRequiredDocsVerified = !!(user.idVerified && user.bloodGroupVerified && user.medicalVerified);
  if (!allRequiredDocsVerified) return false;

  const hasActiveDeferral = !!user.nextEligibleDate && user.nextEligibleDate > new Date();
  if (hasActiveDeferral) {
    await prisma.user.update({
      where: { id: userId },
      data: { donorVerificationStatus: 'ELIGIBLE' },
    });
    return false;
  }

  // Respect donation cooldown — verified documents alone never override it.
  if (user.lastDonationDate) {
    const cooldownEnd = new Date(user.lastDonationDate);
    cooldownEnd.setDate(cooldownEnd.getDate() + DONATION_COOLDOWN_DAYS);
    if (cooldownEnd > new Date()) {
      const daysLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 86_400_000);
      await prisma.user.update({
        where: { id: userId },
        data: {
          donorStatus: 'DEFERRED',
          isDonor: true,
          isDonorEligible: false,
          donorVerificationStatus: 'ELIGIBLE',
          deferralDate: new Date(),
          deferralReason: `Recent donation — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining before next donation.`,
          nextEligibleDate: cooldownEnd,
          eligibilityCheckedAt: new Date(),
        },
      });
      return true;
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      donorStatus: 'ACTIVE',
      isDonor: true,
      isDonorEligible: true,
      donorVerificationStatus: 'ELIGIBLE',
      deferralDate: null,
      deferralReason: null,
      nextEligibleDate: null,
      eligibilityCheckedAt: new Date(),
    },
  });
  return true;
}

// ─── Core: compute + persist ──────────────────────────────────────────────────

export async function computeDonorStatus(userId: string): Promise<DonorStatusResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isDonor:          true,
      isDonorEligible:  true,
      donorStatus:      true,
      nextEligibleDate: true,
      deferralReason:   true,
      totalDonations:   true,
      lastDonationDate: true,
    },
  });
  if (!user) throw new Error('User not found');

  console.log('[DonorStatus] computeDonorStatus called — DB state:',
    user.donorStatus,
    '| isDonor:', user.isDonor,
    '| isDonorEligible:', user.isDonorEligible,
    '| totalDonations:', user.totalDonations,
    '| lastDonationDate:', user.lastDonationDate?.toISOString() ?? 'null',
    '| nextEligibleDate:', user.nextEligibleDate?.toISOString() ?? 'null');

  // Guard 1: registered + eligible via isDonor flag
  if (user.isDonor && user.isDonorEligible) {
    await persistStatus(userId, 'ACTIVE');
    return buildResult(userId);
  }

  // Guard 2: active temporary deferral already persisted (e.g. from health screening).
  // Do NOT call checkEligibility — it short-circuits at Stage 2 (missing medical doc)
  // and would overwrite a valid deferral with NEVER_DONATED.
  if (
    user.donorStatus === 'DEFERRED' &&
    user.nextEligibleDate !== null &&
    user.nextEligibleDate > new Date()
  ) {
    console.log('[DonorStatus] computeDonorStatus: active DEFERRED in DB (expires',
      user.nextEligibleDate.toISOString(), ') — skipping recompute');
    return buildResult(userId);
  }

  // Guard 3: established donor — has donation history in the DB.
  // A user with totalDonations > 0 or a recorded lastDonationDate is never NEVER_DONATED.
  // checkEligibility may not be reliable here (Stage 2 medical-doc short-circuit), so
  // we apply the donation-cooldown rule directly from the DB fields.
  const hasEstablishedHistory = user.totalDonations > 0 || !!user.lastDonationDate;
  if (hasEstablishedHistory) {
    console.log('[DonorStatus] computeDonorStatus: established donor (totalDonations:',
      user.totalDonations, ') — applying donation cooldown logic');

    // Dev bypass: force-activated users skip the cooldown check entirely
    if (isDevForceActive(userId)) {
      console.log('[DevQA] cooldown guard bypassed in computeDonorStatus for force-active userId:', userId);
      await persistStatus(userId, 'ACTIVE', { deferralDate: null, deferralReason: null, nextEligibleDate: null });
      console.log('[DonorStatus] buildResult: ACTIVE | totalDonations:', user.totalDonations);
      return buildResult(userId);
    }

    if (user.lastDonationDate) {
      const cooldownEnd = new Date(user.lastDonationDate);
      cooldownEnd.setDate(cooldownEnd.getDate() + DONATION_COOLDOWN_DAYS);
      if (cooldownEnd > new Date()) {
        const daysLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 86_400_000);
        console.log('[DonorStatus] computeDonorStatus: donation cooldown active —', daysLeft, 'days left, persisting DEFERRED');
        await persistStatus(userId, 'DEFERRED', {
          deferralDate:     new Date(),
          deferralReason:   `Recent donation — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining before next donation.`,
          nextEligibleDate: cooldownEnd,
        });
        return buildResult(userId);
      }
    }

    // Cooldown expired (or no lastDonationDate but totalDonations > 0) → ACTIVE
    console.log('[DonorStatus] computeDonorStatus: donation cooldown cleared — persisting ACTIVE');
    await persistStatus(userId, 'ACTIVE', {
      deferralDate: null, deferralReason: null, nextEligibleDate: null,
    });
    return buildResult(userId);
  }

  // Guard 4: required documents are all VERIFIED but isDonor/isDonorEligible
  // are stale (e.g. the immediate post-verification promotion never ran).
  // Sync directly from the document flags — do not require the HealthScreening
  // questionnaire (Phase 4 engine below) for donors verified purely via documents.
  if (await syncDonorEligibilityFromDocuments(userId)) {
    console.log('[DonorStatus] computeDonorStatus: promoted from verified documents (self-heal)');
    return buildResult(userId);
  }

  // Run Phase 4 eligibility engine
  let elig;
  try {
    elig = await checkEligibility(userId);
  } catch {
    // Can't compute — return cached status if available
    return buildResult(userId);
  }

  if (elig.eligible) {
    // Eligible, but user hasn't hit "Register as Donor" yet → PENDING_REVIEW
    const status: DonorStatus = user.isDonor ? 'ACTIVE' : 'PENDING_REVIEW';
    await persistStatus(userId, status, { deferralDate: null, deferralReason: null, nextEligibleDate: null });
    return buildResult(userId);
  }

  // Permanent medical disqualification
  if (elig.disqualifyingFactors && elig.disqualifyingFactors.length > 0) {
    await persistStatus(userId, 'INELIGIBLE', {
      deferralDate:   new Date(),
      deferralReason: elig.disqualifyingFactors.join('; '),
      nextEligibleDate: null,
    });
    return buildResult(userId);
  }

  // Temporary deferral: cooldown, surgery, tattoo, etc. (nextEligibleDate is set)
  if (elig.nextEligibleDate) {
    await persistStatus(userId, 'DEFERRED', {
      deferralDate:     new Date(),
      deferralReason:   elig.reasons[0] ?? 'Temporary deferral',
      nextEligibleDate: elig.nextEligibleDate,
    });
    return buildResult(userId);
  }

  // Needs documents or health screening → NEVER_DONATED
  await persistStatus(userId, 'NEVER_DONATED', {
    deferralDate: null, deferralReason: null, nextEligibleDate: null,
  });
  return buildResult(userId);
}

// ─── Get (cached or fresh) ────────────────────────────────────────────────────

export async function getDonorStatus(userId: string): Promise<DonorStatusResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      eligibilityCheckedAt: true,
      donorStatus:          true,
      isDonorEligible:      true,
      nextEligibleDate:     true,
      totalDonations:       true,
      lastDonationDate:     true,
    },
  });
  if (!user) throw new Error('User not found');

  const stale =
    !user.eligibilityCheckedAt ||
    Date.now() - user.eligibilityCheckedAt.getTime() > STATUS_CACHE_MS;

  // Impossible-state guard: NEVER_DONATED + donation history is always wrong,
  // regardless of cache freshness. Force computeDonorStatus to correct it.
  const hasEstablishedHistory = user.totalDonations > 0 || !!user.lastDonationDate;
  const impossibleState = user.donorStatus === 'NEVER_DONATED' && hasEstablishedHistory;

  // One-time repair: ACTIVE but isDonorEligible=false is a stale inconsistency.
  // persistStatus now keeps them in sync, but old rows need a one-time patch.
  const eligibilityMismatch = user.donorStatus === 'ACTIVE' && user.isDonorEligible === false;
  if (eligibilityMismatch) {
    console.log('[DonorStatus] getDonorStatus — repairing stale eligibility mismatch for userId:', userId);
    await prisma.user.update({ where: { id: userId }, data: { isDonorEligible: true } });
  }

  console.log('[DonorStatus] getDonorStatus — DB donorStatus:', user.donorStatus,
    '| isDonorEligible:', user.isDonorEligible,
    '| eligibilityCheckedAt:', user.eligibilityCheckedAt?.toISOString() ?? 'null',
    '| stale:', stale,
    '| totalDonations:', user.totalDonations,
    '| hasEstablishedHistory:', hasEstablishedHistory,
    '| impossibleState:', impossibleState,
    '| eligibilityMismatch:', eligibilityMismatch);

  // Guard: ACTIVE + lastDonationDate within 90-day cooldown is always invalid.
  // Triggered when the DB is otherwise inconsistent. Correct it in-place before returning.
  // Dev exception: skip this guard for force-activated users so donation history is preserved.
  const withinCooldown =
    !!user.lastDonationDate &&
    (new Date(user.lastDonationDate).getTime() + DONATION_COOLDOWN_DAYS * 86_400_000) > Date.now();
  if (withinCooldown && user.donorStatus === 'ACTIVE') {
    if (isDevForceActive(userId)) {
      console.log('[DevQA] cooldown guard bypassed for force-active userId:', userId);
    } else {
      const cooldownEnd = new Date(
        new Date(user.lastDonationDate!).getTime() + DONATION_COOLDOWN_DAYS * 86_400_000
      );
      const daysLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 86_400_000);
      console.log(
        '[DonorStatus] getDonorStatus — cooldown guard: ACTIVE + recent lastDonationDate, forcing DEFERRED |',
        'daysLeft:', daysLeft
      );
      await persistStatus(userId, 'DEFERRED', {
        deferralDate:     new Date(),
        deferralReason:   `Recent donation — ${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining before next donation.`,
        nextEligibleDate: cooldownEnd,
      });
      return buildResult(userId);
    }
  }

  if (stale || impossibleState) return computeDonorStatus(userId);
  return buildResult(userId);
}

// ─── Reminder ─────────────────────────────────────────────────────────────────

export async function setDonorReminder(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nextEligibleDate: true },
  });

  await prisma.user.update({ where: { id: userId }, data: { reminderSet: true } });

  if (user?.nextEligibleDate) {
    await prisma.notification.create({
      data: {
        userId,
        title: 'Donation Eligibility Reminder',
        body: `Reminder: You will be eligible to donate blood on ${user.nextEligibleDate.toLocaleDateString('en-IN')}.`,
        notificationType: 'REMINDER',
      },
    });
  }
}

export async function cancelDonorReminder(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { reminderSet: false } });
}
