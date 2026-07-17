import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import { donorService } from '../../services/donorService';
import { donorStatusService } from '../../services/donorStatusService';
import { verificationService } from '../../services/verificationService';
import { EligibilityStatusData, DocumentStatusData, HealthScreeningPayload, DonorStatusData } from '../../types';
import { authService } from '../../services/authService';
import CountdownTimer from '../../components/CountdownTimer';

// ─── Screening cache (local override for Phase 5 lag) ─────────────────────────
// Persisted via SecureStore so it survives app restarts. Cleared once Phase 5
// returns a non-NEVER_DONATED status, at which point the backend is authoritative.

const SCREENING_CACHE_KEY = 'bloodlink_last_screening';
const SCREENING_WINDOW_DAYS = 30;

interface ScreeningCache {
  submittedAt: string;        // ISO — when screening was submitted
  isDeferred: boolean;        // true when user was deferred or found ineligible
  eligible: boolean;
  deferralReason: string | null;
  deferralDate: string | null;
  nextEligibleDate: string | null;
  daysRemaining: number | null;
  reminderSet: boolean;       // whether user has set a donation reminder
}

// ─── Persistent donor state (cross-session memory) ───────────────────────────
// Saves the last known real donor status so stale NEVER_DONATED from Phase 5
// doesn't route returning donors back to the registration flow on cold starts.
// Expires after 90 days. Never saves NEVER_DONATED — only established statuses.

const DONOR_STATE_TTL_DAYS = 90;

interface PersistedDonorState {
  userId: string;             // scoped so cross-user bleed is caught on load
  donorStatus: string;
  totalDonations: number;
  deferralReason: string | null;
  nextEligibleDate: string | null;
  daysRemaining: number | null;
  lastUpdated: string;
}

function getDonorStateKey(userId: string): string {
  return `bloodlink_donor_state:${userId}`;
}

// ─── Flow step machine ────────────────────────────────────────────────────────

type FlowStep =
  | 'loading'           // fetching eligibility
  | 'active_donor'      // ACTIVE — donor dashboard
  | 'inactive'          // INACTIVE — reactivation prompt
  | 'document_needed'   // missing required verified docs
  | 'health_screening'  // needs to fill questionnaire
  | 'blocked'           // DEFERRED, INELIGIBLE, or cooldown
  | 'confirm'           // all checks pass — confirm becoming donor
  | 'submitting'        // calling PUT /become-donor
  | 'success';          // became a donor

type ScreeningSection = 'measurements' | 'medical' | 'recent';

// ─── Blank screening payload ──────────────────────────────────────────────────

const BLANK_SCREENING: HealthScreeningPayload = {
  hasHeartDisease: false, hasDiabetes: false, hasHepatitis: false,
  hasHiv: false, hasTuberculosis: false, hasCancer: false,
  hasBleedingDisorder: false, hasSeizureDisorder: false, hasKidneyDisease: false,
  hasLiverDisease: false, hasRespiratoryDisease: false, hasAutoimmuneDisease: false,
  hasRecentSurgery: false, hasRecentTattoo: false, hasRecentPiercing: false,
  hasRecentTravel: false, hasRecentVaccination: false,
  hasDonatedBefore: false, hasAdverseReaction: false,
  isOnMedication: false, isPregnant: false, isBreastfeeding: false,
  hasConsumedAlcohol24h: false, hasFever: false,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function getDeferralSubtitle(reason: string | null): string {
  if (!reason) return 'You are temporarily deferred from donating. See the details below.';
  const r = reason.toLowerCase();
  if (r.includes('alcohol')) return 'You need to wait before donating because alcohol was consumed recently.';
  if (r.includes('surgery')) return 'A recovery period is required after your recent surgery.';
  if (r.includes('tattoo')) return 'A waiting period is required after a recent tattoo.';
  if (r.includes('piercing')) return 'A waiting period is required after a recent piercing.';
  if (r.includes('vaccination') || r.includes('vaccine')) return 'A waiting period is required after your recent vaccination.';
  if (r.includes('pregnant') || r.includes('pregnancy')) return 'A waiting period applies during or after pregnancy.';
  if (r.includes('breastfeed')) return 'A waiting period applies while breastfeeding.';
  if (r.includes('travel')) return 'A waiting period applies after recent travel to certain regions.';
  return 'You are temporarily deferred from donating. See the details below.';
}

function docLabel(key: string): string {
  const map: Record<string, string> = {
    ID_PROOF: 'Government ID',
    BLOOD_GROUP_PROOF: 'Blood Group Certificate',
    MEDICAL_SCREENING: 'Medical Screening Report',
  };
  return map[key] ?? key;
}

// Derives a concrete countdown target for DEFERRED users, even when
// nextEligibleDate is null. Falls back to daysRemaining → lastDonationDate+90d → tomorrow.
function resolveNextEligibleDate(ds: DonorStatusData): { date: string; estimated: boolean } {
  if (ds.nextEligibleDate) return { date: ds.nextEligibleDate, estimated: false };
  if (ds.daysRemaining && ds.daysRemaining > 0) {
    console.warn('[DonateBlood] DEFERRED with null nextEligibleDate — estimating from daysRemaining');
    return { date: new Date(Date.now() + ds.daysRemaining * 86400000).toISOString(), estimated: true };
  }
  if (ds.lastDonationDate) {
    console.warn('[DonateBlood] DEFERRED with null nextEligibleDate — estimating from lastDonationDate + 90d');
    return { date: new Date(new Date(ds.lastDonationDate).getTime() + 90 * 86400000).toISOString(), estimated: true };
  }
  console.warn('[DonateBlood] DEFERRED with all dates null — using tomorrow fallback');
  return { date: new Date(Date.now() + 86400000).toISOString(), estimated: true };
}

// ─── View Controller ──────────────────────────────────────────────────────────
// A pure function that decides WHICH view to display from the Phase 5 payload.
// It does not coerce or lock any state — it only interprets the data. Calling it
// repeatedly with the same data always yields the same view (idempotent), so a
// noisy/duplicate response can never push a registered donor into registration.
type DonorView =
  | 'LOADING'
  | 'ERROR'
  | 'KEEP'                    // data inconsistency — keep whatever is already on screen
  | 'REGISTRATION_VIEW'       // genuine new donor — legacy Phase 4 flow
  | 'PENDING_VIEW'            // passed all checks, not yet registered — confirm step
  | 'ELIGIBILITY_STATUS_VIEW' // DEFERRED / INELIGIBLE / SUSPENDED — blocked step
  | 'DASHBOARD_VIEW';         // ACTIVE / donation-bearing — active or inactive dashboard

// Statuses that mean the user has already engaged with donor registration. A
// transition from any of these back to NEVER_DONATED is a data inconsistency.
const ESTABLISHED_STATUSES = ['ACTIVE', 'PENDING_REVIEW', 'PENDING', 'DEFERRED', 'INELIGIBLE', 'INACTIVE', 'SUSPENDED'];

function hasDonated(data: DonorStatusData): boolean {
  return (data.totalDonations ?? 0) > 0 || data.lastDonationDate != null;
}

// Multi-factor view controller. `prevStatus` is the last status this screen
// committed in the current session; `isRegisteredDonor` comes from AuthContext.
// `screeningCache` is the SecureStore-backed 30-day local override — when Phase 5
// returns stale NEVER_DONATED after a recent screening, the cache takes priority.
// `persistedState` is the 90-day cross-session donor state — for returning users
// whose Phase 5 returns NEVER_DONATED after an app restart or cache miss.
// NOTE on canBecomeDonor: in this backend canBecomeDonor is true ONLY for
// PENDING_REVIEW, so it is FALSE for genuine new donors too — it therefore cannot
// be used to gate registration, and is intentionally not a guard here.
function determineView(
  data: DonorStatusData | null,
  isLoading: boolean,
  error: boolean,
  prevStatus: string | null,
  isRegisteredDonor: boolean,
  screeningCache: ScreeningCache | null,
  persistedState: PersistedDonorState | null,
): DonorView {
  if (isLoading) return 'LOADING';
  if (error || !data) return 'ERROR';

  const donated = hasDonated(data);
  // Backend may emit statuses outside the typed union (PENDING, SUSPENDED, …),
  // so compare as a string.
  const status = data.donorStatus as string;

  // ── CACHE PRIORITY: Recent screening overrides stale NEVER_DONATED ──
  // If the user just completed a health screening and Phase 5 hasn't synced yet,
  // the cache reflects the real outcome. Only fires when status is NEVER_DONATED
  // (backend stale) AND the cache is within the 30-day window AND isDeferred=true
  // (eligible outcomes don't need an override — Phase 5 sync is fast for those).
  if (screeningCache && screeningCache.isDeferred && status === 'NEVER_DONATED') {
    const cacheAgeDays = (Date.now() - new Date(screeningCache.submittedAt).getTime()) / 86_400_000;
    if (cacheAgeDays < SCREENING_WINDOW_DAYS) {
      console.log('[Phase4Guard] Screening cache active (' + cacheAgeDays.toFixed(2) + ' days old) — blocking Phase 4, routing to ELIGIBILITY_STATUS_VIEW');
      return 'ELIGIBILITY_STATUS_VIEW';
    }
  }

  // ── SAFEGUARD: Persisted donor state overrides stale NEVER_DONATED ──
  // Only fires when Phase5 returned an ambiguous NEVER_DONATED (canBecomeDonor=false
  // or deferral fields present), meaning the backend may be stale. If Phase5 returns
  // canBecomeDonor=true with no deferral, it is a genuine new user — skip safeguard.
  if (persistedState && status === 'NEVER_DONATED') {
    const genuineNewUser = data.canBecomeDonor && !data.deferralReason && !data.nextEligibleDate;
    if (genuineNewUser) {
      console.log('[StateMemory] Phase5 genuine NEVER_DONATED (canBecomeDonor=true, no deferral) — ignoring persisted state');
    } else {
      const ageDays = (Date.now() - new Date(persistedState.lastUpdated).getTime()) / 86_400_000;
      if (ageDays < DONOR_STATE_TTL_DAYS && ESTABLISHED_STATUSES.includes(persistedState.donorStatus)) {
        const ps = persistedState.donorStatus;
        console.log('[StateMemory] SAFEGUARD: Persisted status', ps, '— Phase5 NEVER_DONATED is stale');
        console.log('[StateMemory] using persisted state only because Phase5 returned ambiguous NEVER_DONATED');
        if (ps === 'ACTIVE' || ps === 'INACTIVE')          return 'DASHBOARD_VIEW';
        if (ps === 'PENDING_REVIEW' || ps === 'PENDING')   return 'PENDING_VIEW';
        if (ps === 'DEFERRED' || ps === 'INELIGIBLE' || ps === 'SUSPENDED') return 'ELIGIBILITY_STATUS_VIEW';
      }
    }
  }

  // ── GUARD 0: Explicit eligibility-blocked states — checked FIRST ──
  // DEFERRED users may have 0 donations (failed health screening, no prior history),
  // so hasDonated and ESTABLISHED_STATUSES are not enough to protect them. Check
  // status explicitly so they never fall through to REGISTRATION_VIEW.
  if (status === 'DEFERRED' || status === 'INELIGIBLE' || status === 'SUSPENDED') {
    console.log('[ViewCtrl] GUARD 0:', status, '— routing to ELIGIBILITY_STATUS_VIEW');
    return 'ELIGIBILITY_STATUS_VIEW';
  }

  // ── GUARD 1: AuthContext override ──
  // The global user object says this person is a registered donor, but Phase 5
  // returned NEVER_DONATED — trust AuthContext and show the dashboard.
  // Exception: canBecomeDonor:true means Phase5 is explicitly saying genuine new user.
  // In that case Phase5 is authoritative and the auth override must not fire.
  if (status === 'NEVER_DONATED' && isRegisteredDonor && !data.canBecomeDonor) {
    console.warn('[StateGuard] AuthContext says donor but Phase5 NEVER_DONATED (canBecomeDonor:false) — showing dashboard.');
    return 'DASHBOARD_VIEW';
  }

  // ── GUARD 2: Regression block ──
  // We previously rendered an established status this session; a swing back to
  // NEVER_DONATED is stale/noisy data. Keep the current view, change nothing.
  if (status === 'NEVER_DONATED' && prevStatus && ESTABLISHED_STATUSES.includes(prevStatus)) {
    console.warn('[StateGuard] BLOCKED: regression', prevStatus, '→ NEVER_DONATED. Keeping previous view.');
    return 'KEEP';
  }

  // ── GUARD 3: Donation-history inconsistency ──
  // NEVER_DONATED but the payload itself shows donations → dashboard, not registration.
  if (status === 'NEVER_DONATED' && donated) {
    console.warn('[StateGuard] Inconsistency: NEVER_DONATED with donation history. Showing dashboard.');
    return 'DASHBOARD_VIEW';
  }

  // ── NEVER_DONATED — gate on canBecomeDonor ──
  // After the backend fix: canBecomeDonor is true when DB donorStatus === NEVER_DONATED
  // (genuine new user who hasn't started the registration funnel). False means Phase 5
  // returned a non-NEVER_DONATED DB status, which should have been caught by earlier
  // guards — treat it as a safe fallback to ELIGIBILITY_STATUS_VIEW (never run Phase 4).
  if (status === 'NEVER_DONATED') {
    if (data.canBecomeDonor) return 'REGISTRATION_VIEW';
    console.warn('[ViewCtrl] NEVER_DONATED + canBecomeDonor:false — established user, all caches miss. Safe fallback → ELIGIBILITY_STATUS_VIEW');
    return 'ELIGIBILITY_STATUS_VIEW';
  }

  // Eligible but not yet registered → confirmation step.
  if (status === 'PENDING_REVIEW' || status === 'PENDING') {
    return 'PENDING_VIEW';
  }

  // Registered state OR any donation history → dashboard.
  if (donated || ESTABLISHED_STATUSES.includes(status)) {
    return 'DASHBOARD_VIEW';
  }

  // Unknown status with no history.
  console.warn('[ViewCtrl] Unknown state:', status);
  return 'REGISTRATION_VIEW';
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DonateBloodScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, setUser, updateUser } = useAuthStore();
  const { createChat } = useChatStore();

  const [step, setStep] = useState<FlowStep>('loading');
  const [eligibility, setEligibility] = useState<EligibilityStatusData | null>(null);
  const [docStatus, setDocStatus] = useState<DocumentStatusData | null>(null);
  const [blockReasons, setBlockReasons] = useState<string[]>([]);
  const [donorStatusData, setDonorStatusData] = useState<DonorStatusData | null>(null);

  // Health screening wizard state
  const [section, setSection] = useState<ScreeningSection>('measurements');
  const [screening, setScreening] = useState<HealthScreeningPayload>({ ...BLANK_SCREENING });
  const [screeningLoading, setScreeningLoading] = useState(false);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);

  // Pending blood requests (active_donor view)
  const [emergencyRequests] = useState<any[]>([]);

  // Verification status for active_donor step
  const [verificationOverall, setVerificationOverall] = useState<'FULLY_VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | null>(null);

  // ── Fetch guards ─────────────────────────────────────────────────────────────
  // No state lock / coercion. We only (a) prevent overlapping fetches and
  // (b) ensure the MOST RECENT response wins if several land out of order.
  const isFetchingRef = useRef(false);
  const requestSeqRef = useRef(0);
  // Tracks whether we've resolved at least once, so a focus refetch doesn't flash
  // the loading spinner. This is a display nicety, NOT a state lock.
  const hasResolvedRef = useRef(false);
  // Last status this screen committed this session — used to detect a regression
  // back to NEVER_DONATED (stale data). Reset when the authenticated user changes.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => { prevStatusRef.current = null; }, [user?.id]);

  // ── Post-screening local override ───────────────────────────────────────────
  // Holds the most recent health-screening result submitted this session (or
  // loaded from SecureStore on mount). When Phase 5 returns a stale
  // NEVER_DONATED after a health screening, this cache overrides the view
  // controller to show ELIGIBILITY_STATUS_VIEW instead of the registration form.
  const lastScreeningRef = useRef<ScreeningCache | null>(null);

  // Load persisted screening cache on mount.
  useEffect(() => {
    SecureStore.getItemAsync(SCREENING_CACHE_KEY).then(raw => {
      if (!raw) return;
      try {
        const cache: ScreeningCache = JSON.parse(raw);
        const ageDays = (Date.now() - new Date(cache.submittedAt).getTime()) / 86_400_000;
        if (ageDays < SCREENING_WINDOW_DAYS) {
          lastScreeningRef.current = cache;
          console.log('[ScreeningCache] Loaded valid cache from', cache.submittedAt, '(' + ageDays.toFixed(1) + ' days old)');
        } else {
          // Expired — remove stale entry
          SecureStore.deleteItemAsync(SCREENING_CACHE_KEY).catch(() => {});
        }
      } catch {
        SecureStore.deleteItemAsync(SCREENING_CACHE_KEY).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // ── Persistent donor state (cross-session memory) ──────────────────────────
  // Survives app restarts. Loaded on mount so the SAFEGUARD in determineView
  // can catch stale NEVER_DONATED before it reaches REGISTRATION_VIEW.
  const persistedStateRef = useRef<PersistedDonorState | null>(null);

  // Load persisted donor state — scoped to current userId.
  // Re-runs whenever the authenticated user changes so User B never sees User A's data.
  useEffect(() => {
    persistedStateRef.current = null; // always clear before loading new user's state
    const uid = user?.id;
    if (!uid) return;
    const key = getDonorStateKey(uid);
    console.log('[StateMemory] currentUserId:', uid);
    SecureStore.getItemAsync(key).then(raw => {
      if (!raw) return;
      try {
        const state: PersistedDonorState = JSON.parse(raw);
        // Reject if userId field doesn't match (handles keys written before this fix)
        if (state.userId && state.userId !== uid) {
          console.log('[StateMemory] ignored persisted state because user mismatch:', state.userId, '!=', uid);
          SecureStore.deleteItemAsync(key).catch(() => {});
          return;
        }
        const ageDays = (Date.now() - new Date(state.lastUpdated).getTime()) / 86_400_000;
        if (ageDays < DONOR_STATE_TTL_DAYS) {
          persistedStateRef.current = state;
          console.log('[StateMemory] Loaded persisted status:', state.donorStatus, '(' + ageDays.toFixed(1) + ' days old)');
        } else {
          SecureStore.deleteItemAsync(key).catch(() => {});
        }
      } catch {
        SecureStore.deleteItemAsync(key).catch(() => {});
      }
    }).catch(() => {});
  }, [user?.id]);

  // AuthContext signal: is this user already a registered donor? Used to override
  // a stale NEVER_DONATED from Phase 5.
  const isRegisteredDonor =
    (user as any)?.isDonor === true ||
    user?.isDonorEligible === true ||
    user?.donorProfile?.verificationStatus === 'eligible';

  // ─── Eligibility fetch ───────────────────────────────────────────────────────

  // ─── Phase 5: persisted status check ────────────────────────────────────────
  // Returns DonorStatusData or null. Never throws — errors are caught and logged.
  const checkPhase5Status = useCallback(async (): Promise<DonorStatusData | null> => {
    try {
      const statusRes = await donorStatusService.getStatus();
      console.log('[DonateBlood] Phase5 response:', JSON.stringify(statusRes?.data ?? null));
      if (statusRes.success && statusRes.data) return statusRes.data;
      console.warn('[DonateBlood] Phase5 returned success=false or no data');
      return null;
    } catch (err) {
      console.warn('[DonateBlood] Phase5 getStatus threw:', err);
      return null;
    }
  }, []);

  // ─── Phase 4: legacy new-donor flow ──────────────────────────────────────────
  // ONLY called for NEVER_DONATED users or when Phase 5 is entirely unreachable.
  const runLegacyPhase4Check = useCallback(async () => {
    console.log('[DonateBlood] NEVER_DONATED — Running legacy Phase 4 new donor flow');
    try {
      const [eligRes, docRes] = await Promise.all([
        donorService.getEligibilityStatus(),
        donorService.getDocumentStatus(),
      ]);
      const elig = eligRes.success ? eligRes.data : null;
      const docs = docRes.success ? docRes.data : null;
      setEligibility(elig);
      setDocStatus(docs);

      if (!elig) {
        setBlockReasons(['Could not verify eligibility. Please try again.']);
        setStep('blocked');
        return;
      }

      // Safety net: Phase 5 may have missed an already-active user
      if (user?.isDonorEligible === true || user?.donorProfile?.verificationStatus === 'eligible') {
        console.log('[DonateBlood] Phase4 safety-net → active_donor (isDonorEligible)');
        setStep('active_donor');
        return;
      }

      if (docs && !docs.canProceed) { setStep('document_needed'); return; }

      if (elig.donationCooldown.onCooldown) {
        const next = elig.donationCooldown.nextEligibleDate
          ? `You can donate again on ${formatDate(elig.donationCooldown.nextEligibleDate)}.`
          : `${90 - (elig.donationCooldown.daysSinceLastDonation ?? 0)} days remaining.`;
        setBlockReasons(['You must wait 90 days between blood donations.', next]);
        setStep('blocked');
        return;
      }

      if (!elig.medicalScreening.verified) { setStep('document_needed'); return; }

      if (!elig.healthScreening.completed) {
        setSection('measurements');
        setScreening({ ...BLANK_SCREENING });
        setStep('health_screening');
        return;
      }

      if (elig.healthScreening.passed === false) {
        setBlockReasons([
          'Your health screening indicates you are currently not eligible to donate blood.',
          'This may be due to a medical condition, recent illness, weight, or blood pressure.',
          'Please consult a doctor and submit a new health screening when your condition improves.',
        ]);
        setStep('blocked');
        return;
      }

      if (elig.eligible) { setStep('confirm'); return; }

      setBlockReasons(['You do not currently meet all eligibility requirements.']);
      setStep('blocked');
    } catch (err) {
      console.error('[DonateBlood] Phase4 check threw:', err);
      setBlockReasons(['Could not connect to the server. Please check your connection and try again.']);
      setStep('blocked');
    }
  }, [user]);

  // ─── View Controller dispatch ────────────────────────────────────────────────
  // Fetches Phase 5 data, asks determineView() WHAT to show, then maps that view
  // onto the existing render steps. No state coercion, no lock — the pure view
  // function makes a user with donation history immune to the registration flow.
  const checkEligibility = useCallback(async () => {
    // Prevent overlapping fetches.
    if (isFetchingRef.current) {
      console.log('[DonateBlood] Skipping duplicate fetch — one already in progress.');
      return;
    }
    isFetchingRef.current = true;
    const seq = ++requestSeqRef.current; // newest request id

    // Only flash the spinner before the first resolution.
    if (!hasResolvedRef.current) setStep('loading');

    let ds: DonorStatusData | null = null;
    try {
      ds = await checkPhase5Status();
    } finally {
      isFetchingRef.current = false;
    }

    // Latest-wins: if a newer request started while we awaited, drop this response.
    if (seq !== requestSeqRef.current) {
      console.log('[DonateBlood] Stale response ignored (a newer fetch superseded it).');
      return;
    }
    hasResolvedRef.current = true;

    // Persist the Phase 5 status for cross-session memory. Only established
    // statuses are saved — NEVER_DONATED is never persisted so stale backend
    // responses can't erase valid history.
    const currentUid = user?.id;
    if (ds && ESTABLISHED_STATUSES.includes(ds.donorStatus as string) && currentUid) {
      const stateToSave: PersistedDonorState = {
        userId:           currentUid,
        donorStatus:      ds.donorStatus as string,
        totalDonations:   ds.totalDonations ?? 0,
        deferralReason:   ds.deferralReason ?? null,
        nextEligibleDate: ds.nextEligibleDate ?? null,
        daysRemaining:    ds.daysRemaining ?? null,
        lastUpdated:      new Date().toISOString(),
      };
      persistedStateRef.current = stateToSave;
      SecureStore.setItemAsync(getDonorStateKey(currentUid), JSON.stringify(stateToSave)).catch(() => {});
      console.log('[StateMemory] Persisted donor status:', ds.donorStatus as string, 'for userId:', currentUid);
    } else if (ds && ds.donorStatus === 'NEVER_DONATED' && ds.canBecomeDonor && !ds.deferralReason && !ds.nextEligibleDate && currentUid) {
      // Phase5 explicitly says genuine new user — clear any stale persisted state for this user
      if (persistedStateRef.current !== null) {
        console.log('[StateMemory] Phase5 genuine NEVER_DONATED — clearing persisted state and routing registration');
        persistedStateRef.current = null;
        SecureStore.deleteItemAsync(getDonorStateKey(currentUid)).catch(() => {});
      }
    }

    const view = determineView(ds, false, ds === null, prevStatusRef.current, isRegisteredDonor, lastScreeningRef.current, persistedStateRef.current);

    console.log('[DonateBlood] ========================================');
    console.log('[DonateBlood] Phase5 Response:', JSON.stringify(ds));
    console.log('[DonateBlood] View Controller Decision:');
    console.log('[DonateBlood]   donorStatus:', ds?.donorStatus ?? 'null');
    console.log('[DonateBlood]   totalDonations:', ds?.totalDonations ?? 'null');
    console.log('[DonateBlood]   isEligible:', ds?.isEligible ?? 'null');
    console.log('[DonateBlood]   canBecomeDonor:', ds?.canBecomeDonor ?? 'null');
    console.log('[DonateBlood]   prevStatus:', prevStatusRef.current ?? 'null');
    console.log('[DonateBlood]   isRegisteredDonor(ctx):', isRegisteredDonor);
    console.log('[DonateBlood]   Selected View:', view);
    if (view === 'ELIGIBILITY_STATUS_VIEW') {
      const isFromCache = (ds?.donorStatus as string) === 'NEVER_DONATED' && lastScreeningRef.current !== null;
      const isFromPersisted = !isFromCache && (ds?.donorStatus as string) === 'NEVER_DONATED' && persistedStateRef.current !== null;
      const src = isFromCache ? lastScreeningRef.current! : (isFromPersisted ? persistedStateRef.current! : ds);
      const source = isFromCache ? 'LocalCache' : (isFromPersisted ? 'PersistedState' : 'Phase5API');
      console.log('[DonateBlood]   source:', source);
      console.log('[DonateBlood]   deferralReason:', src?.deferralReason ?? 'null');
      console.log('[DonateBlood]   nextEligibleDate:', src?.nextEligibleDate ?? 'null');
      console.log('[DonateBlood]   daysRemaining:', src?.daysRemaining ?? 'null');
    }
    if (view === 'DASHBOARD_VIEW') {
      const isFromPersisted = (ds?.donorStatus as string) === 'NEVER_DONATED' && persistedStateRef.current !== null;
      console.log('[DonateBlood]   Sub-view: ActiveDashboard');
      if (isFromPersisted) console.log('[DonateBlood]   source: PersistedState (' + persistedStateRef.current!.donorStatus + ')');
    }
    console.log('[DonateBlood] ========================================');

    // ── KEEP: data inconsistency — leave the current view untouched ──
    if (view === 'KEEP') {
      console.warn('[StateGuard] Keeping previous view. No state change, no Phase 4 fallback.');
      return;
    }

    // ── Phase 5 synced: clear stale screening cache ──
    // Once Phase 5 returns a real status (not NEVER_DONATED), the backend has
    // persisted the screening result and the local cache is no longer needed.
    if (ds && ds.donorStatus !== 'NEVER_DONATED' && lastScreeningRef.current) {
      console.log('[LocalOverride] Phase5 synced — clearing local screening cache');
      lastScreeningRef.current = null;
      SecureStore.deleteItemAsync(SCREENING_CACHE_KEY).catch(() => {});
    }

    // ── ERROR / REGISTRATION → legacy Phase 4 flow ──
    // Phase 4 drives genuine new-donor registration (docs → screening → confirm)
    // and also surfaces a connection error if the backend is unreachable.
    // Cache-based ELIGIBILITY_STATUS_VIEW is handled in determineView — if we
    // reach REGISTRATION_VIEW here, the cache is absent or expired.
    if (view === 'ERROR' || view === 'REGISTRATION_VIEW') {
      if (view === 'REGISTRATION_VIEW') {
        prevStatusRef.current = 'NEVER_DONATED';
        console.log('[Phase4Guard] No active screening cache — Phase 4 running for genuine new donor');
      }
      await runLegacyPhase4Check();
      return;
    }

    // ── PENDING → confirm registration ──
    if (view === 'PENDING_VIEW') {
      const psState = persistedStateRef.current;
      const fromPersisted = (ds?.donorStatus as string) === 'NEVER_DONATED' && psState !== null;
      const displayStatus = fromPersisted && psState
        ? psState.donorStatus as DonorStatusData['donorStatus']
        : ds!.donorStatus;
      prevStatusRef.current = displayStatus as string;
      setDonorStatusData({ ...ds!, donorStatus: displayStatus });
      setStep('confirm');
      return;
    }

    // ── ELIGIBILITY_STATUS_VIEW → blocked step (DEFERRED / INELIGIBLE / SUSPENDED) ──
    // Three sources: Phase 5 returned a real blocked status (GUARD 0), the local
    // screening cache overrode stale NEVER_DONATED (cache-priority in determineView),
    // or the persisted state overrode stale NEVER_DONATED (SAFEGUARD in determineView).
    if (view === 'ELIGIBILITY_STATUS_VIEW') {
      const phaseIsStale = !ds || (ds.donorStatus as string) === 'NEVER_DONATED';
      const isFromCache = phaseIsStale && lastScreeningRef.current !== null;
      const psState = persistedStateRef.current;
      const isFromPersisted = phaseIsStale && !isFromCache && psState !== null;

      if (isFromCache) {
        const ls = lastScreeningRef.current!;
        console.log('[ScreeningCache] Rendering blocked step from local cache — Phase5 not yet synced');
        const cacheStatus: DonorStatusData['donorStatus'] =
          ls.eligible ? 'ACTIVE'
            : ls.nextEligibleDate ? 'DEFERRED'
              : 'INELIGIBLE';
        prevStatusRef.current = cacheStatus;
        setDonorStatusData({
          donorStatus:      cacheStatus,
          isEligible:       ls.eligible,
          nextEligibleDate: ls.nextEligibleDate,
          daysRemaining:    ls.daysRemaining,
          deferralDate:     ls.deferralDate,
          deferralReason:   ls.deferralReason,
          totalDonations:   0,
          lastDonationDate: null,
          reminderSet:      ls.reminderSet,
          canBecomeDonor:   false,
        });
        const onCooldown = !!(ls.nextEligibleDate) || (ls.daysRemaining ?? 0) > 0;
        if (cacheStatus === 'DEFERRED' && onCooldown) {
          const days = ls.daysRemaining ?? 0;
          const next = ls.nextEligibleDate
            ? `Eligible again on ${formatDate(ls.nextEligibleDate)}.`
            : days > 0
              ? `Approximately ${days} day${days === 1 ? '' : 's'} remaining.`
              : 'Eligibility date is being calculated.';
          setBlockReasons([ls.deferralReason ?? 'You are temporarily deferred from donating blood.', next]);
        } else {
          setBlockReasons([
            ls.deferralReason ?? 'Your health screening indicates you are not currently eligible to donate.',
            'Please consult a doctor for more information.',
          ]);
        }
        setStep('blocked');
        return;
      }

      // Persisted state: Phase 5 stale, no screening cache, but prior session knew status.
      if (isFromPersisted && psState) {
        const psStatus = psState.donorStatus;
        console.log('[StateMemory] Rendering blocked step from persisted state (' + psStatus + ')');
        prevStatusRef.current = psStatus;
        setDonorStatusData({
          donorStatus:      psStatus as DonorStatusData['donorStatus'],
          isEligible:       false,
          nextEligibleDate: psState.nextEligibleDate,
          daysRemaining:    psState.daysRemaining,
          deferralDate:     null,
          deferralReason:   psState.deferralReason,
          totalDonations:   psState.totalDonations,
          lastDonationDate: null,
          reminderSet:      false,
          canBecomeDonor:   false,
        });
        if (psStatus === 'SUSPENDED') {
          setBlockReasons([
            psState.deferralReason ? `Account suspended: ${psState.deferralReason}` : 'Your donor account is currently suspended.',
            'Please contact support for assistance.',
          ]);
        } else if (psStatus === 'INELIGIBLE') {
          setBlockReasons([
            psState.deferralReason ? `Medical condition: ${psState.deferralReason}` : 'You are not currently eligible to donate blood.',
            'Please consult a doctor for more information.',
          ]);
        } else {
          const days = psState.daysRemaining ?? 0;
          const next = psState.nextEligibleDate
            ? `Eligible again on ${formatDate(psState.nextEligibleDate)}.`
            : days > 0
              ? `Approximately ${days} day${days === 1 ? '' : 's'} remaining.`
              : 'Your eligibility is being evaluated. Please check back soon.';
          setBlockReasons([psState.deferralReason ?? 'You are temporarily deferred from donating blood.', next]);
        }
        setStep('blocked');
        return;
      }

      // Phase 5 returned a real blocked status (GUARD 0: DEFERRED / INELIGIBLE / SUSPENDED)
      // OR the canBecomeDonor:false fallback for stale NEVER_DONATED (Mode 2).
      const elStatus = ds!.donorStatus as string;
      prevStatusRef.current = elStatus;

      const onCooldown =
        !!ds!.nextEligibleDate || (ds!.daysRemaining ?? 0) > 0 || elStatus === 'DEFERRED';
      const displayStatus: string =
        elStatus === 'SUSPENDED' ? 'SUSPENDED'
          : elStatus === 'INELIGIBLE' ? 'INELIGIBLE'
            : onCooldown ? 'DEFERRED'
              : elStatus; // includes 'NEVER_DONATED' for Mode 2 fallback

      setDonorStatusData({ ...ds!, donorStatus: displayStatus as DonorStatusData['donorStatus'] });

      if (displayStatus === 'DEFERRED') {
        const days = ds!.daysRemaining ?? 0;
        const next = ds!.nextEligibleDate
          ? `Eligible again on ${formatDate(ds!.nextEligibleDate)}.`
          : days > 0
            ? `Approximately ${days} day${days === 1 ? '' : 's'} remaining.`
            : 'Eligibility date is being calculated.';
        setBlockReasons([ds!.deferralReason ?? 'You are temporarily deferred from donating blood.', next]);
      } else if (displayStatus === 'SUSPENDED') {
        setBlockReasons([
          ds!.deferralReason ? `Account suspended: ${ds!.deferralReason}` : 'Your donor account is currently suspended.',
          'Please contact support for assistance.',
        ]);
      } else {
        setBlockReasons([
          ds!.deferralReason ? `Medical condition: ${ds!.deferralReason}` : 'You are not currently eligible to donate blood.',
          'Please consult a doctor for more information.',
        ]);
      }
      setStep('blocked');
      return;
    }

    // ── DASHBOARD ──
    // If we were routed here from a NEVER_DONATED payload (GUARD 1 AuthContext
    // override, GUARD 3 donation history, or SAFEGUARD persisted state), present
    // the user as a registered donor rather than letting isEligible=false drop them.
    let status = ds!.donorStatus as string;
    let isEligible = ds!.isEligible;
    if (status === 'NEVER_DONATED') {
      const psState = persistedStateRef.current;
      if (psState && (psState.donorStatus === 'ACTIVE' || psState.donorStatus === 'INACTIVE')) {
        status = psState.donorStatus;
        console.log('[StateMemory] Dashboard coercion: using persisted status:', status);
        isEligible = status === 'ACTIVE';
      } else {
        status = 'ACTIVE';
        if (isRegisteredDonor) isEligible = true;
      }
    }
    prevStatusRef.current = status;

    // Inactive donors get their own reactivation view.
    if (status === 'INACTIVE') {
      setDonorStatusData(ds!);
      setStep('inactive');
      return;
    }

    // Active eligible donor → dashboard.
    if (isEligible) {
      setDonorStatusData({ ...ds!, donorStatus: status as DonorStatusData['donorStatus'], isEligible: true });
      setStep('active_donor');
      return;
    }

    // Safety net: DASHBOARD_VIEW with isEligible=false (unexpected — GUARD 0 should
    // have caught genuine blocked statuses). Show blocked rather than crash.
    const onCooldownFallback = !!ds!.nextEligibleDate || (ds!.daysRemaining ?? 0) > 0;
    const fallbackDisplay: string = onCooldownFallback ? 'DEFERRED' : status;
    setDonorStatusData({ ...ds!, donorStatus: fallbackDisplay as DonorStatusData['donorStatus'] });
    setBlockReasons([
      ds!.deferralReason ?? 'You are not currently eligible to donate blood.',
      ds!.nextEligibleDate ? `Eligible again on ${formatDate(ds!.nextEligibleDate)}.` : 'Please consult a doctor.',
    ]);
    setStep('blocked');
  }, [checkPhase5Status, runLegacyPhase4Check, isRegisteredDonor]);

  useFocusEffect(useCallback(() => { checkEligibility(); }, [checkEligibility]));

  // Auto-navigate to home after the success screen — no need for the user to tap "Done"
  useEffect(() => {
    if (step !== 'success') return;
    const t = setTimeout(() => router.replace('/(tabs)'), 2500);
    return () => clearTimeout(t);
  }, [step, router]);

  // Fetch verification status once the active_donor dashboard is shown
  useEffect(() => {
    if (step !== 'active_donor') return;
    setVerificationOverall(null); // reset so we don't flash stale state
    verificationService.getStatus().then(res => {
      const ovStatus = res?.data?.overallStatus ?? 'UNVERIFIED';
      console.log('[DonorDashboard] verificationComplete:', ovStatus === 'FULLY_VERIFIED');
      setVerificationOverall(ovStatus);
    }).catch(() => {
      console.log('[DonorDashboard] verificationComplete: false (fetch error)');
      setVerificationOverall('UNVERIFIED');
    });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Health Screening submit ──────────────────────────────────────────────────

  const handleSubmitScreening = async () => {
    console.log('[HealthScreening] SUBMIT BUTTON PRESSED', JSON.stringify(screening));
    setScreeningLoading(true);
    setScreeningError(null);
    try {
      const res = await donorService.submitHealthScreening(screening);
      if (!res.success) {
        setScreeningError(res.message ?? 'Submission failed. Please try again.');
        return;
      }

      const result = res.data;

      // Persist screening result locally so the Phase 5 lag doesn't send the
      // user back to the registration form if they navigate away and return.
      const cache: ScreeningCache = {
        submittedAt:      new Date().toISOString(),
        isDeferred:       !result.eligibility.eligible,
        eligible:         result.eligibility.eligible,
        deferralReason:   result.eligibility.eligible ? null
          : result.disqualifyingFactors.length > 0 ? result.disqualifyingFactors.join('; ')
            : result.eligibility.reasons[0] ?? null,
        deferralDate:     result.eligibility.eligible ? null : new Date().toISOString(),
        nextEligibleDate: result.eligibility.nextEligibleDate ?? null,
        daysRemaining:    result.eligibility.nextEligibleDate
          ? Math.ceil((new Date(result.eligibility.nextEligibleDate).getTime() - Date.now()) / 86_400_000)
          : null,
        reminderSet:      false,
      };
      lastScreeningRef.current = cache;
      SecureStore.setItemAsync(SCREENING_CACHE_KEY, JSON.stringify(cache)).catch(() => {});

      if (result.eligibility.eligible) {
        setStep('confirm');
      } else {
        // The eligibility field in this response reflects checkEligibility's result at
        // submission time, which may have short-circuited before Stage 4d (e.g. no
        // medical verification document yet). The backend has already persisted the
        // authoritative status (DEFERRED for alcohol/surgery/etc., INELIGIBLE for
        // permanent conditions). Re-query Phase 5 to get the correct state.
        await checkEligibility();
      }
    } catch {
      setScreeningError('Network error. Please check your connection and try again.');
    } finally {
      setScreeningLoading(false);
    }
  };

  // ─── Become Donor submit ──────────────────────────────────────────────────────

  const handleBecomeDonor = async () => {
    setStep('submitting');
    try {
      // Final document check before submission
      const docCheck = await donorService.getDocumentStatus();
      if (docCheck.success && !docCheck.data.canProceed) {
        setDocStatus(docCheck.data);
        setStep('document_needed');
        return;
      }

      const res = await donorService.becomeDonor();
      if (!res.success) {
        await checkEligibility();
        return;
      }

      // Optimistic update — ensures active_donor view shows immediately on next focus.
      // determineView() routes any donation-bearing payload to the dashboard, so no
      // lock is needed to hold this state.
      updateUser({ isDonor: true, isDonorEligible: true });

      // Update Phase 5 local state immediately so home screen shows correct button on return
      setDonorStatusData(prev => prev
        ? { ...prev, donorStatus: 'ACTIVE', isEligible: true, canBecomeDonor: false }
        : { donorStatus: 'ACTIVE', isEligible: true, nextEligibleDate: null, daysRemaining: null,
            deferralDate: null, deferralReason: null, totalDonations: 0,
            lastDonationDate: null, reminderSet: false, canBecomeDonor: false }
      );

      // Fetch full profile to get donorProfile (verificationStatus: 'eligible'), donation history, etc.
      const profileRes = await authService.getProfile();
      if (profileRes.success && profileRes.data) {
        setUser(profileRes.data);
        // mapUserToApi doesn't include isDonor/isDonorEligible directly — re-apply after setUser overwrites them
        updateUser({ isDonor: true, isDonorEligible: true });
      }

      setStep('success');
    } catch {
      Alert.alert('Error', 'Could not complete registration. Please try again.');
      setStep('confirm');
    }
  };

  // ─── Reminder ────────────────────────────────────────────────────────────────

  const handleSetReminder = async () => {
    const nextDate = donorStatusData?.nextEligibleDate ?? eligibility?.donationCooldown.nextEligibleDate;
    if (!nextDate) return;
    setReminderLoading(true);
    try {
      // Use Phase 5 reminder service when a donorStatus is available
      if (donorStatusData) {
        await donorStatusService.setReminder();
        setDonorStatusData(prev => prev ? { ...prev, reminderSet: true } : prev);
      } else {
        await donorService.setReminder(nextDate);
      }
      // Persist reminderSet in the local cache so it survives app restarts.
      if (lastScreeningRef.current) {
        const updated: ScreeningCache = { ...lastScreeningRef.current, reminderSet: true };
        lastScreeningRef.current = updated;
        SecureStore.setItemAsync(SCREENING_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      }
      Alert.alert('Reminder Set', `We'll remind you on ${formatDate(nextDate)}.`);
    } catch {
      Alert.alert('Error', 'Could not set reminder. Please try again.');
    } finally {
      setReminderLoading(false);
    }
  };

  // ─── Screening field helpers ──────────────────────────────────────────────────

  const setFlag = (key: keyof HealthScreeningPayload, val: boolean) =>
    setScreening(s => ({ ...s, [key]: val }));

  const setMeasurement = (key: keyof HealthScreeningPayload, val: string) => {
    const num = parseFloat(val);
    setScreening(s => ({ ...s, [key]: isNaN(num) ? undefined : num }));
  };

  const setString = (key: keyof HealthScreeningPayload, val: string) =>
    setScreening(s => ({ ...s, [key]: val || undefined }));

  // ─── Renders ──────────────────────────────────────────────────────────────────

  const Header = ({ title }: { title: string }) => (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.surface }]} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  // ── LOADING ──────────────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Donate Blood" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Checking your eligibility...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── SUBMITTING ────────────────────────────────────────────────────────────────
  if (step === 'submitting') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Registering..." />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={styles.loadingText}>Completing your registration...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── SUCCESS ───────────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Donate Blood" />
        <ScrollView contentContainerStyle={styles.centered}>
          <View style={styles.successIcon}>
            <Ionicons name="heart" size={64} color="#fff" />
          </View>
          <Text style={styles.successTitle}>You're a Donor!</Text>
          <Text style={styles.successSub}>
            Thank you for registering as a blood donor. You're now helping save lives.
          </Text>
          {user?.donorEligibilityExpiry && (
            <View style={styles.infoCard}>
              <Ionicons name="calendar-outline" size={18} color={Colors.light.primary} />
              <Text style={styles.infoCardText}>
                Your donor eligibility is valid until {formatDate(user.donorEligibilityExpiry)}.
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              // replace() clears the modal from the stack — pressing back from home
              // won't pop back into the registration form
              router.replace('/(tabs)');
            }}
          >
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── DOCUMENTS NEEDED ──────────────────────────────────────────────────────────
  if (step === 'document_needed') {
    const missing = docStatus?.needsDocuments ?? [];
    const isMedOnly = missing.length === 1 && missing[0] === 'MEDICAL_SCREENING';
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Documents Required" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroSection}>
            <View style={[styles.iconCircle, { backgroundColor: '#FEF9E7' }]}>
              <Ionicons name="document-text-outline" size={40} color="#E67E22" />
            </View>
            <Text style={styles.heroTitle}>Documents Needed</Text>
            <Text style={styles.heroSub}>
              {isMedOnly
                ? 'You need a verified Medical Screening Report to become a donor.'
                : 'The following documents must be verified before you can become a donor.'}
            </Text>
          </View>

          {missing.map(doc => (
            <View key={doc} style={styles.docRow}>
              <Ionicons name="close-circle" size={22} color="#E74C3C" />
              <View style={styles.docInfo}>
                <Text style={styles.docLabel}>{docLabel(doc)}</Text>
                <Text style={styles.docSub}>Not verified — tap below to upload</Text>
              </View>
            </View>
          ))}

          {/* Show verified docs too */}
          {docStatus?.existingDocuments && Object.entries(docStatus.existingDocuments).map(([key, doc]) => {
            if (!doc) return null;
            const type = key === 'idProof' ? 'ID_PROOF'
              : key === 'bloodGroupProof' ? 'BLOOD_GROUP_PROOF'
              : 'MEDICAL_SCREENING';
            return (
              <View key={key} style={styles.docRow}>
                <Ionicons name="checkmark-circle" size={22} color="#2ECC71" />
                <View style={styles.docInfo}>
                  <Text style={styles.docLabel}>{docLabel(type)}</Text>
                  <Text style={[styles.docSub, { color: '#2ECC71' }]}>Verified{doc.expiryDate ? ` · expires ${formatDate(doc.expiryDate)}` : ''}</Text>
                </View>
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { router.back(); router.push('/profile/verification-status'); }}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Upload Documents</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => checkEligibility()}>
            <Text style={styles.ghostBtnText}>Check Again</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── BLOCKED (DEFERRED / INELIGIBLE / cooldown) ───────────────────────────────
  if (step === 'blocked') {
    const isDeferred = donorStatusData?.donorStatus === 'DEFERRED';
    const isPhase4Cooldown = !isDeferred && eligibility?.donationCooldown.onCooldown === true;
    const isCooldown = isDeferred || isPhase4Cooldown;

    const blockedTitle = isDeferred
      ? 'Temporarily Deferred'
      : isPhase4Cooldown
        ? 'Donation Cooldown'
        : 'Not Eligible to Donate';

    const blockedSub = isDeferred
      ? getDeferralSubtitle(donorStatusData?.deferralReason ?? null)
      : isPhase4Cooldown
        ? 'You recently donated blood. Your body needs time to recover before your next donation.'
        : 'Based on your health information, you are not currently eligible to donate blood.';

    // Always resolve a countdown target for DEFERRED — never leave it null
    const resolved = (isDeferred && donorStatusData) ? resolveNextEligibleDate(donorStatusData) : null;
    const nextDate  = resolved?.date ?? eligibility?.donationCooldown.nextEligibleDate ?? null;
    const isEstimated = resolved?.estimated ?? false;

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="Eligibility Status" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroSection}>
            <View style={[styles.iconCircle, { backgroundColor: '#FDEDEC' }]}>
              <Ionicons name={isCooldown ? 'timer-outline' : 'alert-circle-outline'} size={40} color="#E74C3C" />
            </View>
            <Text style={[styles.heroTitle, { color: colors.text }]}>{blockedTitle}</Text>
            <Text style={[styles.heroSub, { color: colors.muted }]}>{blockedSub}</Text>
          </View>

          <View style={[styles.reasonsCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.reasonsTitle, { color: colors.text }]}>{isCooldown ? 'Details' : 'Reasons'}</Text>
            {blockReasons.map((r, i) => (
              <View key={i} style={styles.reasonRow}>
                <Ionicons
                  name={isCooldown ? 'information-circle-outline' : 'close-circle-outline'}
                  size={16}
                  color={isCooldown ? '#E67E22' : '#E74C3C'}
                  style={{ marginTop: 2 }}
                />
                <Text style={[styles.reasonText, { color: colors.muted }]}>{r}</Text>
              </View>
            ))}
          </View>

          {/* Next eligible date card (always shown for cooldown, even when estimated) */}
          {isCooldown && nextDate && (
            <View style={styles.nextDateCard}>
              <Ionicons name="calendar-outline" size={20} color={Colors.light.primary} />
              <Text style={styles.nextDateText}>
                Next eligible:{' '}
                <Text style={styles.nextDateBold}>{formatDate(nextDate)}</Text>
                {isEstimated ? <Text style={{ color: '#999' }}> (estimated)</Text> : null}
              </Text>
            </View>
          )}

          {/* Countdown timer — always shown for DEFERRED, with fallback date */}
          {isCooldown && (
            <View style={[styles.countdownCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.countdownLabel, { color: colors.muted }]}>
                Time remaining{isEstimated ? ' (estimated)' : ''}
              </Text>
              {nextDate ? (
                <CountdownTimer
                  targetDate={nextDate}
                  onExpired={() => checkEligibility()}
                />
              ) : (
                <Text style={{ fontFamily: 'Poppins_500Medium', fontSize: 13, color: colors.muted, textAlign: 'center' }}>
                  Eligibility status being updated — check back in 24 hours.
                </Text>
              )}
            </View>
          )}

          {isCooldown && (
            <TouchableOpacity
              style={[styles.primaryBtn, (reminderLoading || !nextDate) && { opacity: 0.7 }]}
              onPress={handleSetReminder}
              disabled={reminderLoading || !nextDate}
            >
              {reminderLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="notifications-outline" size={18} color="#fff" style={{ marginRight: 8 }} />}
              <Text style={styles.primaryBtnText}>Set Reminder</Text>
            </TouchableOpacity>
          )}

          {!isCooldown && (
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={18} color="#5DADE2" />
              <Text style={styles.infoCardText}>
                Some conditions are temporary. Consult a doctor and resubmit your health screening when eligible.
              </Text>
            </View>
          )}

          <TouchableOpacity style={[styles.ghostBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => checkEligibility()}>
            <Ionicons name="refresh-outline" size={16} color={Colors.light.primary} style={{ marginRight: 6 }} />
            <Text style={styles.ghostBtnText}>Check Again</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Become a Donor" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroSection}>
            <View style={[styles.iconCircle, { backgroundColor: '#EAFAF1' }]}>
              <MaterialCommunityIcons name="hand-heart" size={44} color="#27AE60" />
            </View>
            <Text style={styles.heroTitle}>You're Eligible!</Text>
            <Text style={styles.heroSub}>
              All eligibility checks have passed. Tap below to officially register as a blood donor.
            </Text>
          </View>

          <View style={styles.checklist}>
            {[
              'Medical screening documents verified',
              'Health questionnaire completed',
              'No active donation cooldown',
              'Physical requirements met',
            ].map(item => (
              <View key={item} style={styles.checkRow}>
                <Ionicons name="checkmark-circle" size={20} color="#27AE60" />
                <Text style={styles.checkText}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.light.primary} />
            <Text style={styles.infoCardText}>
              Your donor status is valid for 6 months. You'll need to renew your health screening afterwards.
            </Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleBecomeDonor} activeOpacity={0.85}>
            <Ionicons name="heart" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Register as Donor</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Not Now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── ACTIVE DONOR DASHBOARD ────────────────────────────────────────────────────
  if (step === 'active_donor') {
    const totalDons = donorStatusData?.totalDonations ?? user?.donorProfile?.totalDonations ?? 0;
    const lastDon   = donorStatusData?.lastDonationDate ?? (user?.donorProfile as any)?.lastDonationDate ?? null;
    const livesSaved = totalDons * 3;
    const canDonate  = donorStatusData?.isEligible ?? user?.isDonorEligible ?? false;

    // Show Verification Pending if docs have loaded and are not fully verified
    if (verificationOverall !== null && verificationOverall !== 'FULLY_VERIFIED') {
      return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <Header title="Donor Dashboard" />
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.donorPendingBanner, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
              <Ionicons name="time-outline" size={24} color="#E67E22" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.donorPendingName}>Verification Pending</Text>
                <Text style={[styles.donorPendingExpiry, { color: colors.muted }]}>
                  Complete document verification to become a fully verified donor.
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={18} color="#2C5F8A" />
              <Text style={styles.infoCardText}>
                Your donor status is active, but required documents must be approved before you can respond to blood requests.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => { router.back(); router.push('/profile/verification-status'); }}
            >
              <Ionicons name="document-text-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>Go to Verification</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container}>
        <Header title="Donor Dashboard" />
        <ScrollView contentContainerStyle={styles.content}>

          {/* Status banner */}
          <View style={styles.donorActiveBanner}>
            <Ionicons name="heart" size={24} color="#fff" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.donorActiveName}>Active Donor</Text>
              <Text style={styles.donorActiveExpiry}>
                {canDonate ? 'Ready to donate' : 'Status active'}
              </Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color="#fff" opacity={0.8} />
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.statValue}>{totalDons}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Donations</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.statValue}>{livesSaved}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Lives Saved</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.statValue}>{lastDon ? formatDate(lastDon) : '—'}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Last Donation</Text>
            </View>
          </View>

          {/* Reminder toggle (Fix 2.4) */}
          <View style={[styles.reminderToggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.reminderToggleLabel, { color: colors.text }]}>Remind me when eligible</Text>
              <Text style={[styles.reminderToggleSub, { color: colors.muted }]}>Get a notification when you can donate again</Text>
            </View>
            <Switch
              value={Boolean(donorStatusData?.reminderSet)}
              disabled={reminderLoading}
              onValueChange={async (val) => {
                setReminderLoading(true);
                try {
                  if (val) await donorStatusService.setReminder();
                  else await donorStatusService.cancelReminder();
                  setDonorStatusData(prev => prev ? { ...prev, reminderSet: val } : prev);
                } catch {
                  Alert.alert('Error', 'Could not update reminder. Please try again.');
                } finally {
                  setReminderLoading(false);
                }
              }}
              trackColor={{ true: Colors.light.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Nearby requests */}
          {emergencyRequests.length === 0 ? (
            <>
              {/* Ready card */}
              <View style={[styles.reasonsCard, { marginBottom: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={22} color={Colors.light.primary} />
                  <Text style={styles.reasonsTitle}>You're ready to help</Text>
                </View>
                <Text style={[styles.reasonText, { color: '#888' }]}>
                  We'll show matching blood requests near you when they are available.
                </Text>
              </View>

              {/* Tips card */}
              <View style={[styles.reasonsCard, { marginBottom: 14 }]}>
                <Text style={styles.reasonsTitle}>Before you donate</Text>
                {[
                  { icon: 'restaurant-outline' as const,   tip: 'Eat a light meal' },
                  { icon: 'water-outline' as const,        tip: 'Stay hydrated' },
                  { icon: 'card-outline' as const,         tip: 'Carry a valid ID' },
                ].map(({ icon, tip }) => (
                  <View key={tip} style={styles.reasonRow}>
                    <Ionicons name={icon} size={16} color={Colors.light.primary} style={{ marginTop: 2 }} />
                    <Text style={styles.reasonText}>{tip}</Text>
                  </View>
                ))}
              </View>

              {/* Impact card */}
              <View style={styles.infoCard}>
                <Ionicons name="heart-outline" size={18} color="#2C5F8A" />
                <Text style={styles.infoCardText}>
                  One donation can help save up to 3 lives.
                </Text>
              </View>
            </>
          ) : (
            emergencyRequests.map(req => (
              <View key={req.id} style={[styles.requestCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={styles.requestBloodGroup}>{req.bloodGroup}</Text>
                <Text style={[styles.requestHospital, { color: colors.muted }]}>{req.hospitalName}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── INACTIVE DONOR ────────────────────────────────────────────────────────────
  if (step === 'inactive') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Donor Status Inactive" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroSection}>
            <View style={[styles.iconCircle, { backgroundColor: '#F2F3F4' }]}>
              <Ionicons name="pause-circle-outline" size={40} color="#7F8C8D" />
            </View>
            <Text style={styles.heroTitle}>Donor Status Inactive</Text>
            <Text style={styles.heroSub}>
              Your donor profile is currently inactive. Reactivate it to start helping people again.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={async () => {
              setStep('loading');
              try {
                await donorStatusService.reactivate();
                await checkEligibility();
              } catch {
                Alert.alert('Error', 'Could not reactivate. Please try again.');
                setStep('inactive');
              }
            }}
          >
            <Ionicons name="refresh" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Reactivate Donor Status</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Not Now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── HEALTH SCREENING FORM ─────────────────────────────────────────────────────
  // (step === 'health_screening')

  const BoolField = ({
    label, fieldKey, detail,
  }: { label: string; fieldKey: keyof HealthScreeningPayload; detail?: string }) => (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {detail && <Text style={styles.switchDetail}>{detail}</Text>}
      </View>
      <Switch
        value={Boolean(screening[fieldKey])}
        onValueChange={val => setFlag(fieldKey, val)}
        trackColor={{ true: Colors.light.primary }}
        thumbColor="#fff"
      />
    </View>
  );

  const steps: ScreeningSection[] = ['measurements', 'medical', 'recent'];
  const stepIdx = steps.indexOf(section);
  const stepLabels = ['Measurements', 'Medical History', 'Recent Events'];

  const advanceSection = () => {
    if (stepIdx < steps.length - 1) {
      setSection(steps[stepIdx + 1]);
    } else {
      handleSubmitScreening();
    }
  };

  const backSection = () => {
    if (stepIdx > 0) setSection(steps[stepIdx - 1]);
    else setStep('loading');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={backSection}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Health Screening</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        {steps.map((s, i) => (
          <View key={s} style={[styles.progressSegment, i <= stepIdx && styles.progressSegmentActive]} />
        ))}
      </View>
      <Text style={styles.stepLabel}>
        Step {stepIdx + 1} of {steps.length}: {stepLabels[stepIdx]}
      </Text>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* ── Section 1: Measurements ── */}
          {section === 'measurements' && (
            <>
              <Text style={styles.sectionDesc}>
                Optional measurements. Providing these helps us give you a more accurate eligibility result.
              </Text>

              {[
                { key: 'weight', label: 'Weight (kg)', placeholder: 'e.g. 65' },
                { key: 'height', label: 'Height (cm)', placeholder: 'e.g. 170' },
                { key: 'hemoglobinLevel', label: 'Hemoglobin (g/dL)', placeholder: 'e.g. 14.5' },
                { key: 'pulseRate', label: 'Pulse Rate (bpm)', placeholder: 'e.g. 72' },
                { key: 'temperature', label: 'Body Temperature (°C)', placeholder: 'e.g. 37.0' },
              ].map(({ key, label, placeholder }) => (
                <View key={key} style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  <TextInput
                    style={styles.inputField}
                    placeholder={placeholder}
                    placeholderTextColor="#aaa"
                    keyboardType="numeric"
                    value={screening[key as keyof HealthScreeningPayload] != null
                      ? String(screening[key as keyof HealthScreeningPayload])
                      : ''}
                    onChangeText={val => setMeasurement(key as keyof HealthScreeningPayload, val)}
                  />
                </View>
              ))}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Blood Pressure (systolic/diastolic)</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="e.g. 120/80"
                  placeholderTextColor="#aaa"
                  value={typeof screening.bloodPressure === 'string' ? screening.bloodPressure : ''}
                  onChangeText={val => setString('bloodPressure', val)}
                />
                <Text style={styles.inputHint}>Format: 120/80</Text>
              </View>
            </>
          )}

          {/* ── Section 2: Medical History ── */}
          {section === 'medical' && (
            <>
              <Text style={styles.sectionDesc}>
                Please answer honestly. All information is confidential and used only for eligibility assessment.
              </Text>
              <View style={styles.switchCard}>
                <BoolField label="Heart disease or heart condition" fieldKey="hasHeartDisease" />
                <BoolField label="Diabetes (Type 1 or Type 2)" fieldKey="hasDiabetes" />
                <BoolField label="Hepatitis B or C" fieldKey="hasHepatitis" />
                <BoolField label="HIV / AIDS" fieldKey="hasHiv" />
                <BoolField label="Active tuberculosis" fieldKey="hasTuberculosis" />
                <BoolField label="Cancer (under treatment)" fieldKey="hasCancer" />
                <BoolField label="Bleeding or clotting disorder" fieldKey="hasBleedingDisorder" />
                <BoolField label="Seizure or epilepsy disorder" fieldKey="hasSeizureDisorder" />
                <BoolField label="Kidney disease (severe)" fieldKey="hasKidneyDisease" />
                <BoolField label="Liver disease (severe)" fieldKey="hasLiverDisease" />
                <BoolField label="Chronic respiratory disease" fieldKey="hasRespiratoryDisease" />
                <BoolField label="Autoimmune disease (lupus, RA, etc.)" fieldKey="hasAutoimmuneDisease" />
              </View>
            </>
          )}

          {/* ── Section 3: Recent Events ── */}
          {section === 'recent' && (
            <>
              <Text style={styles.sectionDesc}>
                Recent events may temporarily defer your eligibility. Answer for the past 12 months.
              </Text>
              <View style={styles.switchCard}>
                <BoolField label="Surgery in the last 6 months" fieldKey="hasRecentSurgery" />
                <BoolField label="Tattoo in the last 6 months" fieldKey="hasRecentTattoo" />
                <BoolField label="Piercing in the last 6 months" fieldKey="hasRecentPiercing" />
                <BoolField label="Travel to malaria-endemic region (last 3 months)" fieldKey="hasRecentTravel" />
                {screening.hasRecentTravel && (
                  <View style={styles.inputGroup}>
                    <TextInput
                      style={styles.inputField}
                      placeholder="Country travelled to"
                      placeholderTextColor="#aaa"
                      value={screening.recentTravelCountry ?? ''}
                      onChangeText={val => setString('recentTravelCountry', val)}
                    />
                  </View>
                )}
                <BoolField label="Vaccination in the last 2 weeks" fieldKey="hasRecentVaccination" />
                <BoolField label="Donated blood before" fieldKey="hasDonatedBefore" />
                {screening.hasDonatedBefore && (
                  <BoolField
                    label="Had adverse reaction to previous donation?"
                    fieldKey="hasAdverseReaction"
                    detail="Dizziness, fainting, prolonged weakness, etc."
                  />
                )}
                <BoolField label="Currently taking medication" fieldKey="isOnMedication" />
                {screening.isOnMedication && (
                  <View style={styles.inputGroup}>
                    <TextInput
                      style={[styles.inputField, { height: 72 }]}
                      placeholder="List medications (e.g. Aspirin, blood thinners)"
                      placeholderTextColor="#aaa"
                      multiline
                      value={screening.medicationDetails ?? ''}
                      onChangeText={val => setString('medicationDetails', val)}
                    />
                  </View>
                )}
                <BoolField label="Currently pregnant" fieldKey="isPregnant" />
                <BoolField label="Currently breastfeeding" fieldKey="isBreastfeeding" />
                <BoolField label="Consumed alcohol in the last 24 hours" fieldKey="hasConsumedAlcohol24h" />
                <BoolField label="Currently have fever" fieldKey="hasFever" />
              </View>
            </>
          )}

          {screeningError && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={18} color="#E74C3C" />
              <Text style={styles.errorText}>{screeningError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, screeningLoading && { opacity: 0.7 }]}
            onPress={advanceSection}
            disabled={screeningLoading}
            activeOpacity={0.85}
          >
            {screeningLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <>
                  <Text style={styles.primaryBtnText}>
                    {stepIdx < steps.length - 1 ? 'Next' : 'Submit Screening'}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
                </>
              )}
          </TouchableOpacity>

          <Text style={styles.privacyNote}>
            Your health information is private and used only to assess your donation eligibility.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#FAFAFA' },
  centered:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle:   { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#333' },
  content:       { padding: 20, paddingBottom: 50 },
  loadingText:   { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#888', marginTop: 16 },

  // Progress
  progressBar:   { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  progressSegment: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: '#E8E8E8',
  },
  progressSegmentActive: { backgroundColor: Colors.light.primary },
  stepLabel:     { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#888', paddingHorizontal: 20, marginBottom: 8, marginTop: 6 },

  // Hero section
  heroSection: { alignItems: 'center', marginBottom: 28, marginTop: 12 },
  iconCircle: {
    width: 90, height: 90, borderRadius: 45,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  heroTitle:   { fontFamily: 'Poppins_700Bold', fontSize: 24, color: '#222', textAlign: 'center', marginBottom: 8 },
  heroSub:     { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },

  // Success
  successIcon: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.light.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  successTitle:  { fontFamily: 'Poppins_700Bold', fontSize: 26, color: '#222', marginBottom: 10, textAlign: 'center' },
  successSub:    { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 24 },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.light.primary, padding: 18, borderRadius: 14, marginBottom: 12,
    elevation: 4, shadowColor: Colors.light.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },
  primaryBtnText: { fontFamily: 'Poppins_600SemiBold', color: '#fff', fontSize: 16 },
  ghostBtn: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
    padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#E0E0E0',
    backgroundColor: '#fff',
  },
  ghostBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: Colors.light.primary },

  // Info card
  infoCard: {
    flexDirection: 'row', backgroundColor: '#EBF5FB', borderRadius: 12,
    padding: 14, marginBottom: 20, gap: 10, alignItems: 'flex-start',
  },
  infoCardText: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#2C5F8A', flex: 1, lineHeight: 20 },

  // Reasons card
  reasonsCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 20,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6,
  },
  reasonsTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#222', marginBottom: 12 },
  reasonRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 10 },
  reasonText:   { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#555', flex: 1, lineHeight: 20 },

  // Cooldown next date
  nextDateCard: {
    flexDirection: 'row', backgroundColor: '#FFF3E0', borderRadius: 12,
    padding: 14, marginBottom: 16, gap: 10, alignItems: 'center',
  },
  nextDateText:  { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#7D6608' },
  nextDateBold:  { fontFamily: 'Poppins_700Bold', color: '#E67E22' },
  countdownCard: {
    backgroundColor: '#F9F9F9', borderRadius: 16, padding: 18,
    marginBottom: 20, alignItems: 'center',
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4,
  },
  countdownLabel: {
    fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#888',
    marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8,
  },

  // Document rows
  docRow: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 10, gap: 12,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4,
  },
  docInfo: { flex: 1 },
  docLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#222', marginBottom: 2 },
  docSub:   { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#999' },

  // Checklist
  checklist: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 20,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6,
  },
  checkRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  checkText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#333' },

  // Active donor banner
  donorActiveBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.primary,
    borderRadius: 16, padding: 18, marginBottom: 16,
  },
  donorActiveName:    { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#fff' },
  donorActiveExpiry:  { fontFamily: 'Poppins_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  // Verification pending banner
  donorPendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9E7',
    borderRadius: 16, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: '#F39C12',
  },
  donorPendingName:   { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#E67E22' },
  donorPendingExpiry: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginTop: 2 },

  // Donor dashboard stats
  statsRow: {
    flexDirection: 'row', gap: 10, marginBottom: 20,
  },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6,
  },
  statValue:  { fontFamily: 'Poppins_700Bold', fontSize: 20, color: Colors.light.primary, marginBottom: 2 },
  statLabel:  { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#888', textAlign: 'center' },

  reminderToggleRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 20,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6,
  },
  reminderToggleLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#333' },
  reminderToggleSub:   { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#888', marginTop: 2 },

  // Empty state
  emptyState: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#888' },
  emptySub:   { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#aaa', textAlign: 'center', lineHeight: 20 },

  // Request card placeholder
  requestCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  requestBloodGroup: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: Colors.light.primary },
  requestHospital: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#666' },

  // Health screening form
  sectionDesc: {
    fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#666', lineHeight: 20, marginBottom: 20,
  },
  switchCard: {
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 8, paddingHorizontal: 16,
    marginBottom: 20, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6,
  },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  switchLabel:  { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#333', flex: 1 },
  switchDetail: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#999', marginTop: 2 },

  inputGroup:   { marginBottom: 16 },
  inputLabel:   { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#444', marginBottom: 6 },
  inputField: {
    backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#E8E8E8',
    borderRadius: 12, padding: 14, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#333',
  },
  inputHint:    { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#999', marginTop: 4 },

  errorCard: {
    flexDirection: 'row', backgroundColor: '#FDEDEC', borderRadius: 12,
    padding: 14, marginBottom: 16, gap: 10, alignItems: 'flex-start',
  },
  errorText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#C0392B', flex: 1 },

  privacyNote: {
    fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#bbb',
    textAlign: 'center', marginTop: 16, lineHeight: 18,
  },
});
