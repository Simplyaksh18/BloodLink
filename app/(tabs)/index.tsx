import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { requestService, bloodBankService, donorService, BankWithStats, BankRequest } from '../../services/bloodService';
import { authService } from '../../services/authService';
import { donorStatusService } from '../../services/donorStatusService';
import { notificationService } from '../../services/notificationService';
import { getSocket } from '../../services/socketService';
import { BloodBank, DonorCard, DonorStatusData } from '../../types';
import * as Location from 'expo-location';
import { timeAgo } from '../../utils/timeAgo';
import { useTheme } from '../../context/ThemeContext';

const EMOJI_OPTIONS = ['👨','👩','🧑','👦','👧','🧔','👩‍⚕️','👨‍⚕️','🏥','🏦','🩸','❤️'];

const ALL_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Request blood group → donor blood groups that can respond
const BLOOD_GROUP_COMPATIBILITY: Record<string, string[]> = {
  'A+':  ['A+', 'A-', 'O+', 'O-'],
  'A-':  ['A-', 'O-'],
  'B+':  ['B+', 'B-', 'O+', 'O-'],
  'B-':  ['B-', 'O-'],
  'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  'AB-': ['A-', 'B-', 'AB-', 'O-'],
  'O+':  ['O+', 'O-'],
  'O-':  ['O-'],
};

const PRIORITY_OPTIONS = [
  { label: 'All', value: null as string | null },
  { label: 'Critical', value: 'RED' },
  { label: 'Moderate', value: 'YELLOW' },
  { label: 'Normal', value: 'GREEN' },
];

// Normalize both DB enum (RED/YELLOW/GREEN) and mapped display values (critical/moderate/stable).
function normalizePriority(val: string): string {
  const up = (val ?? '').toUpperCase();
  if (up === 'RED' || up === 'CRITICAL') return 'RED';
  if (up === 'YELLOW' || up === 'MODERATE') return 'YELLOW';
  if (up === 'GREEN' || up === 'STABLE' || up === 'NORMAL') return 'GREEN';
  return up;
}

interface DonorCtx {
  donorId: string;
  bloodGroup: string | undefined;
  donorStatus: string | undefined;
  isDonorEligible: boolean;
}

// Single authoritative filter deciding whether a donor sees a given request in Give Blood mode.
// Rules: eligibility → status → not-own → targeted visibility → blood compatibility → priority.
function canDonorSeeRequest(
  donor: DonorCtx,
  request: any,
  filters: { priorityFilter: string | null },
): { include: boolean; reason: string } {
  const { donorId, bloodGroup, donorStatus, isDonorEligible } = donor;
  const { priorityFilter } = filters;

  if (__DEV__) {
    console.log('[GiveBloodFilter] donorId:', donorId);
    console.log('[GiveBloodFilter] donorBloodGroup:', bloodGroup ?? 'unknown');
    console.log('[GiveBloodFilter] donorStatus:', donorStatus ?? 'unknown');
    console.log('[GiveBloodFilter] isDonorEligible:', isDonorEligible);
    console.log('[GiveBloodFilter] requestId:', request.id);
    console.log('[GiveBloodFilter] requestBloodGroup:', request.bloodGroup);
    console.log('[GiveBloodFilter] requestStatus:', request.rawStatus ?? request.status);
    console.log('[GiveBloodFilter] targetedDonorId:', request.targetedDonorId ?? null);
    console.log('[GiveBloodFilter] priorityParam:', priorityFilter ?? null);
  }

  // Rule 1: Donor must be ACTIVE and eligible.
  if (!isDonorEligible) {
    if (__DEV__) {
      console.log('[GiveBloodFilter] compatible: false');
      console.log('[GiveBloodFilter] include: false');
      console.log('[GiveBloodFilter] excludeReason: donor_not_eligible');
    }
    return { include: false, reason: 'donor_not_eligible' };
  }

  // Rule 2: Request must be ACTIVE or OPEN only.
  const rawSt = (request.rawStatus ?? '').toUpperCase();
  const frontSt = (request.status ?? '').toLowerCase();
  const isOpenOrActive = rawSt === 'OPEN' || rawSt === 'ACTIVE' || frontSt === 'open';
  if (!isOpenOrActive) {
    if (__DEV__) {
      console.log('[GiveBloodFilter] compatible: false');
      console.log('[GiveBloodFilter] include: false');
      console.log('[GiveBloodFilter] excludeReason: request_not_active');
    }
    return { include: false, reason: 'request_not_active' };
  }

  // Rule 3: Requester must not be the current donor.
  if (donorId && request.userId && request.userId === donorId) {
    if (__DEV__) {
      console.log('[GiveBloodFilter] compatible: false');
      console.log('[GiveBloodFilter] include: false');
      console.log('[GiveBloodFilter] excludeReason: own_request');
    }
    return { include: false, reason: 'own_request' };
  }

  // Rule 4: Targeted donor visibility.
  if (request.targetedDonorId) {
    if (request.targetedDonorId !== donorId) {
      if (__DEV__) {
        console.log('[GiveBloodFilter] compatible: false');
        console.log('[GiveBloodFilter] include: false');
        console.log('[GiveBloodFilter] excludeReason: targeted_to_other_donor');
      }
      return { include: false, reason: 'targeted_to_other_donor' };
    }
    // Targeted to this donor — skip blood group check.
    if (priorityFilter) {
      const normalizedReqPriority = normalizePriority(request.emergencyLevel ?? '');
      if (__DEV__) console.log('[GiveBloodFilter] normalizedRequestPriority:', normalizedReqPriority);
      if (normalizedReqPriority !== priorityFilter) {
        if (__DEV__) {
          console.log('[GiveBloodFilter] compatible: true');
          console.log('[GiveBloodFilter] include: false');
          console.log('[GiveBloodFilter] excludeReason: priority_mismatch');
        }
        return { include: false, reason: 'priority_mismatch' };
      }
    } else {
      if (__DEV__) console.log('[GiveBloodFilter] normalizedRequestPriority: (no filter)');
    }
    if (__DEV__) {
      console.log('[GiveBloodFilter] compatible: true');
      console.log('[GiveBloodFilter] include: true');
      console.log('[GiveBloodFilter] excludeReason: none');
    }
    return { include: true, reason: 'targeted_to_me' };
  }

  // Rule 5: Blood group compatibility for universal requests.
  // BLOOD_GROUP_COMPATIBILITY maps request blood group → eligible donor blood groups.
  // Correct lookup: check if the donor's blood group is in the request's eligible donors list.
  let compatible = true;
  if (bloodGroup && request.bloodGroup) {
    const eligibleDonors = BLOOD_GROUP_COMPATIBILITY[request.bloodGroup] ?? [];
    compatible = eligibleDonors.includes(bloodGroup);
  }
  if (__DEV__) console.log('[GiveBloodFilter] compatible:', compatible);

  if (!compatible) {
    if (__DEV__) {
      console.log('[GiveBloodFilter] include: false');
      console.log('[GiveBloodFilter] excludeReason: blood_group_incompatible');
    }
    return { include: false, reason: 'blood_group_incompatible' };
  }

  // Rule 6: Priority filter — normalize both DB enum and mapped display values before comparing.
  if (priorityFilter) {
    const normalizedReqPriority = normalizePriority(request.emergencyLevel ?? '');
    if (__DEV__) console.log('[GiveBloodFilter] normalizedRequestPriority:', normalizedReqPriority);
    if (normalizedReqPriority !== priorityFilter) {
      if (__DEV__) {
        console.log('[GiveBloodFilter] include: false');
        console.log('[GiveBloodFilter] excludeReason: priority_mismatch');
      }
      return { include: false, reason: 'priority_mismatch' };
    }
  } else {
    if (__DEV__) console.log('[GiveBloodFilter] normalizedRequestPriority: (no filter)');
  }

  if (__DEV__) {
    console.log('[GiveBloodFilter] include: true');
    console.log('[GiveBloodFilter] excludeReason: none');
  }
  return { include: true, reason: 'passed_all_filters' };
}

function getEmergencyBadge(level: string): { label: string; color: string; bg: string } {
  const upper = (level || '').toUpperCase();
  if (upper === 'RED' || upper === 'CRITICAL') return { label: 'CRITICAL', color: '#C0392B', bg: '#FDEDEC' };
  if (upper === 'YELLOW' || upper === 'MODERATE') return { label: 'MODERATE', color: '#E67E22', bg: '#FEF9E7' };
  return { label: 'NORMAL', color: '#27AE60', bg: '#EAFAF1' };
}

export default function HomeScreen() {
  const router = useRouter();

  const [emergencyRequests, setEmergencyRequests] = useState<any[]>([]);
  const [acceptedRequestIds, setAcceptedRequestIds] = useState<Set<string>>(new Set());
  const [bloodBanks, setBloodBanks] = useState<BloodBank[]>([]);
  const [activeTab, setActiveTab] = useState<'requests' | 'banks' | 'donors'>('requests');
  const [nearbyDonors, setNearbyDonors] = useState<DonorCard[]>([]);
  const [loadingDonors, setLoadingDonors] = useState(false);
  const [donorError, setDonorError] = useState(false);
  const [donorNoBg, setDonorNoBg] = useState(false);
  const [selectedBloodGroup, setSelectedBloodGroup] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [bankError, setBankError] = useState(false);
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  const [daysLeft, setDaysLeft] = useState('0');
  const [donorStatusData, setDonorStatusData] = useState<DonorStatusData | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dashMode, setDashMode] = useState<'give' | 'find'>('find');

  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(state => state.setUser);
  const { colors, isDark, toggleTheme } = useTheme();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [savingEmoji, setSavingEmoji] = useState(false);

  const defaultEmoji = user?.role === 'BLOOD_BANK' ? '🏥' : '🧑';
  const displayEmoji = user?.profileEmoji ?? defaultEmoji;

  const handlePickEmoji = async (emoji: string) => {
    setShowEmojiPicker(false);
    setSavingEmoji(true);
    try {
      const res = await authService.updateEmoji(emoji);
      if (res.success && res.data) setUser(res.data);
      console.log('[ProfileEmoji] selected:', emoji);
    } catch {
      Alert.alert('Error', 'Could not save emoji. Please try again.');
    } finally {
      setSavingEmoji(false);
    }
  };

  // ── Derive display-state ──────────────────────────────────────────────────────
  // Phase5 is authoritative once loaded. Use Math.max across all sources so that
  // DevQA Force Active (which returns totalDonations=0) never resets a real count.
  const totalDonations = Math.max(
    donorStatusData?.totalDonations ?? 0,
    (user as any)?.totalDonations ?? 0,
    user?.donorProfile?.totalDonations ?? 0,
    Math.floor((user?.livesSaved ?? 0) / 3),
  );
  const hasDonationHistory = totalDonations > 0 || !!donorStatusData?.lastDonationDate;
  const authSaysDonor =
    user?.isDonorEligible === true ||
    !!(user as any)?.isDonor ||
    !!user?.donorProfile;
  const phase5Loaded = donorStatusData !== null;
  const isActiveDonor = phase5Loaded
    ? (donorStatusData?.donorStatus === 'ACTIVE' && donorStatusData?.isEligible === true)
    : authSaysDonor;

  // donorVariant drives the action card. Phase5 is authoritative once loaded.
  const donorVariant =
    !phase5Loaded                                                       ? (authSaysDonor ? 'active' : 'register') :
    donorStatusData?.donorStatus === 'ACTIVE'                           ? 'active' :
    donorStatusData?.donorStatus === 'PENDING_REVIEW'                   ? 'pending' :
    donorStatusData?.donorStatus === 'DEFERRED'                         ? 'deferred' :
    donorStatusData?.donorStatus === 'INELIGIBLE'                       ? 'ineligible' :
    donorStatusData?.donorStatus === 'SUSPENDED'                        ? 'ineligible' :
    (donorStatusData?.donorStatus === 'NEVER_DONATED' && authSaysDonor) ? 'pending' :
    'register';

  // Refs so useFocusEffect always reads current filter values
  const bgRef = useRef<string | null>(null);
  const prRef = useRef<string | null>(null);
  bgRef.current = selectedBloodGroup;
  prRef.current = selectedPriority;

  // Bug 4: refs so stale closure in useFocusEffect(useCallback(…, [])) always gets current Phase5 state
  const donorStatusRef = useRef<DonorStatusData | null>(null);
  const isActiveDonorRef = useRef<boolean>(false);
  donorStatusRef.current = donorStatusData;
  isActiveDonorRef.current = isActiveDonor;

  const doFetchRequests = async (bg: string | null, pr: string | null) => {
    setLoadingRequests(true);
    setRequestError(false);
    try {
      // Bug 4: read from refs — safe inside stale closure captured by useFocusEffect(useCallback(…, []))
      const currentDonorStatusData = donorStatusRef.current;
      const currentIsActiveDonor = isActiveDonorRef.current;
      const currentPhase5Loaded = currentDonorStatusData !== null;

      if (__DEV__) {
        console.log('[GiveBloodFilterFix] phase5Loaded:', currentPhase5Loaded);
        console.log('[GiveBloodFilterFix] finalDonorStatus:', currentDonorStatusData?.donorStatus ?? 'null');
        console.log('[GiveBloodFilterFix] finalIsEligible:', currentIsActiveDonor);
      }

      // Always request eligibility-filtered results for Give Blood mode.
      // Backend gates on donorStatus=ACTIVE+isDonorEligible and returns empty if not eligible.
      const eligibleForMe = true;

      console.log('[NearbyRequests] fetching: bloodGroup=', bg, 'priority=', pr, 'eligibleForMe=', eligibleForMe);
      const res = await requestService.getFilteredRequests(bg ?? undefined, pr ?? undefined, 1, eligibleForMe);

      if (res.success && res.data) {
        const items = res.data.data ?? [];
        console.log('[NearbyRequests] raw count:', items.length);

        // Bug 4: if Phase5 not loaded yet, skip eligibility filter — don't block on "unknown" status.
        // The useEffect([phase5Loaded]) below will re-run this once Phase5 loads.
        if (!currentPhase5Loaded) {
          console.log('[NearbyRequests] phase5 not loaded — deferring eligibility filter');
          setEmergencyRequests(items);
          return;
        }

        const donorCtx: DonorCtx = {
          donorId: (user as any)?.id ?? (user as any)?.userId ?? '',
          bloodGroup: (user as any)?.bloodGroup as string | undefined,
          donorStatus: currentDonorStatusData?.donorStatus,
          isDonorEligible: currentIsActiveDonor,
        };

        const filtered = items.filter((r: any) => {
          const compat = canDonorSeeRequest(donorCtx, r, { priorityFilter: pr }).include;
          // After compatibility, enforce the dashboard chip: when a bloodGroup is
          // selected, only requests with the exact same group pass. When "All" is
          // selected (bg === null/undefined), everything compatible passes.
          const exactMatch = !bg || r.bloodGroup === bg;
          const included = compat && exactMatch;
          console.log('[NearbyRequests] selectedBloodGroup:', bg ?? 'ALL',
                      '| requestBloodGroup:', r.bloodGroup,
                      '| included:', included);
          return included;
        });
        console.log('[NearbyRequests] after canDonorSeeRequest filter:', filtered.length);
        setEmergencyRequests(filtered);
      } else {
        console.log('[NearbyRequests] raw count: 0 (no data)');
        setEmergencyRequests([]);
      }
    } catch (err) {
      console.log('[NearbyRequests] fetch error:', err);
      setRequestError(true);
    } finally {
      setLoadingRequests(false);
    }
  };

  const doFetchBanks = async () => {
    setLoadingBanks(true);
    setBankError(false);
    try {
      const res = await bloodBankService.getAllBanks();
      if (res.success && res.data) setBloodBanks(res.data);
      else setBloodBanks([]);
    } catch {
      setBankError(true);
    } finally {
      setLoadingBanks(false);
    }
  };

  const doFetchDonors = async () => {
    setLoadingDonors(true);
    setDonorError(false);
    setDonorNoBg(false);
    try {
      const userBg: string | undefined = (user as any)?.bloodGroup;
      const compatibleGroups: string[] = userBg ? (BLOOD_GROUP_COMPATIBILITY[userBg] ?? []) : [];

      console.log('[DonorDiscovery] source: importedDonor=true (backend filtered)');
      console.log('[DonorDiscovery] requestedBloodGroup:', userBg ?? 'unknown');
      console.log('[DonorDiscovery] compatibleGroups:', compatibleGroups);

      if (!userBg) {
        console.log('[DonorDiscoveryUI] empty state reason: no_blood_group');
        setDonorNoBg(true);
        setNearbyDonors([]);
        setLoadingDonors(false);
        return;
      }

      // Pass ALL compatible blood groups to backend — backend filters importedDonor=true + IN(groups).
      // Do NOT use GPS: imported donors have latitude:0/longitude:0 which breaks haversine search.
      const city: string = (user as any)?.location?.city ?? (user as any)?.city ?? '';
      const res = await donorService.getDonorsByFilter(
        compatibleGroups.length > 0 ? compatibleGroups : undefined,
        city || undefined
      );

      if (res?.success && res.data) {
        const donors = res.data as DonorCard[];
        console.log('[DonorDiscovery] result count:', donors.length);
        console.log('[DonorDiscovery] first result names:', donors.slice(0, 10).map(d => d.name));

        // Bug 3: log availability of each donor; only allow "Request Blood" for ACTIVE donors
        donors.forEach((d) => {
          const isActive = d.donorStatus === 'ACTIVE';
          const isImported = d.importedDonor === true;
          const include = isActive || isImported; // imported shown as contact-pending
          if (__DEV__) {
            console.log('[DonorDiscoveryAvailability] donorId:', d.id);
            console.log('[DonorDiscoveryAvailability] donorStatus:', d.donorStatus ?? 'unknown');
            console.log('[DonorDiscoveryAvailability] isDonorEligible:', d.isImportedVerified ?? false);
            console.log('[DonorDiscoveryAvailability] accountClaimed:', !isImported);
            console.log('[DonorDiscoveryAvailability] include:', include);
            if (!include) console.log('[DonorDiscoveryAvailability] excludeReason: not_active_not_imported');
          }
        });

        setNearbyDonors(donors);
        console.log('[DataSync] importedDonorsCount:', donors.length);
        if (donors.length === 0) {
          console.log('[DonorDiscoveryUI] empty state reason: no_imported_donors_for_blood_group — run importLiveDonors.js if not done');
        }
      } else {
        setNearbyDonors([]);
        console.log('[DonorDiscovery] result count: 0 (API error or empty)');
        console.log('[DataSync] importedDonorsCount: 0');
      }
    } catch (err) {
      console.log('[DonorDiscovery] fetch error:', err);
      setDonorError(true);
    } finally {
      setLoadingDonors(false);
    }
  };

  // Refresh everything when screen comes back into focus
  useFocusEffect(
    useCallback(() => {
      authService.getProfile().then(res => {
        if (res.success && res.data) setUser(res.data);
      }).catch(() => {});

      donorStatusService.getStatus().then(res => {
        if (res.success && res.data) setDonorStatusData(res.data);
      }).catch(() => {});

      // Load accepted request IDs so already-accepted cards are hidden from the feed
      requestService.getAcceptedRequests().then(res => {
        const ids = new Set<string>((res?.data ?? []).map((r: any) => r.requestId as string));
        setAcceptedRequestIds(ids);
      }).catch(() => {});

      notificationService.getUnreadCount().then(res => {
        const count = res?.data?.count ?? 0;
        console.log('[NotificationBell] unread count:', count);
        setUnreadCount(count);
      }).catch(() => {});

      doFetchRequests(bgRef.current, prRef.current);
      doFetchBanks();
    }, [])
  );

  // Refetch requests when filters change
  useEffect(() => {
    doFetchRequests(selectedBloodGroup, selectedPriority);
  }, [selectedBloodGroup, selectedPriority]);

  // Fetch donors when tab is selected
  useEffect(() => {
    if (activeTab === 'donors' && nearbyDonors.length === 0 && !loadingDonors) {
      doFetchDonors();
    }
  }, [activeTab]);

  // Mode switcher: reset active tab and log mode change
  useEffect(() => {
    if (dashMode === 'give') {
      setActiveTab('requests');
      console.log('[DashboardMode] currentMode: Give');
      console.log('[UI-Render] showingWidget: GiveBloodMode, LivesSaved, NextEligible, DonorActionCard, RequestsFeed');
    } else {
      setActiveTab('donors');
      console.log('[DashboardMode] currentMode: Find');
      console.log('[UI-Render] showingWidget: FindBloodMode, CompatibleDonors, BloodBanks');
    }
  }, [dashMode]);

  // Real-time: listen to socket notification events to update bell badge
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onNew = (notif?: { type?: string }) => {
      // NEW_MESSAGE notifications are tracked by the Messages tab badge — skip the bell
      if (notif?.type === 'NEW_MESSAGE') return;
      console.log('[Socket] notification:new');
      notificationService.getUnreadCount()
        .then(res => setUnreadCount(res?.data?.count ?? 0))
        .catch(() => {});
      // Refresh donor status after fulfilment to keep Lives Saved accurate
      if (notif?.type === 'REQUEST_FULFILLED' || notif?.type === 'DONATION_PROOF_SUBMITTED') {
        donorStatusService.getStatus()
          .then(res => { if (res.success && res.data) setDonorStatusData(res.data); })
          .catch(() => {});
      }
    };

    const onUnreadCount = (data: { unreadCount: number }) => {
      console.log('[Socket] unread-count', data.unreadCount);
      setUnreadCount(data.unreadCount);
    };

    socket.on('notification:new', onNew);
    socket.on('notification:unread-count', onUnreadCount);

    return () => {
      socket.off('notification:new', onNew);
      socket.off('notification:unread-count', onUnreadCount);
    };
  }, []);

  // Live timer countdown to midnight
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const hrs = String(23 - now.getHours()).padStart(2, '0');
      const mins = String(59 - now.getMinutes()).padStart(2, '0');
      const secs = String(59 - now.getSeconds()).padStart(2, '0');
      setTimeLeft(`${hrs}:${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync days-left counter from server eligibility
  useEffect(() => {
    if (user?.donationEligibility) {
      setDaysLeft(String(user.donationEligibility.daysRemaining));
    } else {
      setDaysLeft('0');
    }
  }, [user]);

  const handleAction = async (action: string, id: string) => {
    const request = emergencyRequests.find(r => r.id === id);

    if (action === 'Accept' && request) {
      try {
        const response = await requestService.respondToRequest(id, 'ACCEPTED');
        console.log('[RequestResponse] accept API success:', response?.success);

        setEmergencyRequests(prev => prev.filter(req => req.id !== id));
        setAcceptedRequestIds(prev => new Set([...prev, id]));

        const requesterName = request.requesterName || request.name || 'User';
        const conversationId = response?.data?.conversationId;
        if (conversationId) {
          router.push(`/(modals)/chat?conversationId=${conversationId}&name=${encodeURIComponent(requesterName)}&role=Request` as any);
        } else {
          router.push('/(tabs)/inbox' as any);
        }
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ??
          err?.response?.data?.error ??
          err?.message ??
          'Could not save your response. Please try again.';
        console.log('[RequestResponse] accept API failed message:', msg);
        Alert.alert('Error', msg);
      }
    } else {
      setEmergencyRequests(prev => prev.filter(req => req.id !== id));
      Alert.alert('Request Ignored', 'You have ignored this blood request.');
    }
  };

  const toggleBloodGroup = (bg: string) => {
    setSelectedBloodGroup(prev => (prev === bg ? null : bg));
  };

  // Priority order:
  //   1. isActiveDonor (multi-signal) takes precedence over raw donorStatus
  //   2. DEFERRED with days remaining
  //   3. NEVER_DONATED → Register
  //   4. Other statuses → fallback
  const nextEligibleLabel: string = (() => {
    if (!phase5Loaded)                                       return authSaysDonor ? 'Eligible Now' : '...';
    if (donorStatusData?.donorStatus === 'DEFERRED') {
      const dr = donorStatusData?.daysRemaining;
      return dr != null ? `${dr}d left` : 'Deferred';
    }
    if (donorStatusData?.donorStatus === 'INELIGIBLE')       return 'Not Eligible';
    if (donorStatusData?.donorStatus === 'SUSPENDED')        return 'Not Eligible';
    if (donorStatusData?.donorStatus === 'ACTIVE' && donorStatusData?.isEligible) return 'Eligible Now';
    if (donorStatusData?.donorStatus === 'PENDING_REVIEW')   return 'Pending';
    if (donorStatusData?.donorStatus === 'NEVER_DONATED' && authSaysDonor) return 'Pending';
    if (donorStatusData?.donorStatus === 'NEVER_DONATED')    return 'Register';
    return 'Check Status';
  })();

  // Safe component-scope check — used only for diagnostic logging below.
  // NOT used in donorVariant (which reads Phase5 directly, no auth bypass).
  const standardVerificationComplete =
    user?.donorProfile?.verificationStatus === 'eligible' ||
    user?.donorProfile?.verificationStatus === 'VERIFIED';
  const importedVerificationComplete =
    user?.importedDonor === true && (user as any)?.isImportedVerified === true;
  const verificationComplete = Boolean(standardVerificationComplete || importedVerificationComplete);

  // Diagnostic logs — fire whenever display-state inputs change
  useEffect(() => {
    if (__DEV__) {
      console.log('[DonorTruth] phase5Loaded:', phase5Loaded);
      console.log('[DonorTruth] phase5Status:', donorStatusData?.donorStatus ?? 'null');
      console.log('[DonorTruth] usingSource:', phase5Loaded ? 'Phase5' : 'AuthFallback');
      console.log('[DonorTruth] finalIsActiveDonor:', isActiveDonor);
      console.log('[HomeDashboardDisplay] raw donorStatus:', donorStatusData?.donorStatus ?? 'null (loading)');
      console.log('[LivesSavedSource] phase5Loaded:', phase5Loaded);
      console.log('[LivesSavedSource] phase5TotalDonations:', donorStatusData?.totalDonations ?? 'N/A');
      console.log('[LivesSavedSource] authTotalDonations:', (user as any)?.totalDonations ?? user?.donorProfile?.totalDonations ?? 0);
      console.log('[LivesSavedSource] selectedTotalDonations:', totalDonations);
      console.log('[HomeDashboardDisplay] totalDonations:', totalDonations);
      console.log('[LivesSaved] livesSaved:', totalDonations * 3);
      console.log('[HomeDashboardDisplay] hasDonationHistory:', hasDonationHistory);
      console.log('[HomeDashboardDisplay] authSaysDonor:', authSaysDonor);
      console.log('[HomeDashboardDisplay] nextEligibleLabel:', nextEligibleLabel);
      // Bug 1 diagnostic: single-source-of-truth for dashboard card
      console.log('[DonorTruthFix] phase5Loaded:', phase5Loaded);
      console.log('[DonorTruthFix] phase5Status:', donorStatusData?.donorStatus ?? 'null');
      console.log('[DonorTruthFix] verificationComplete:', verificationComplete);
      console.log('[DonorTruthFix] finalDashboardCard:', donorVariant);
    }
  }, [donorStatusData, isActiveDonor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bug 4: once Phase5 loads, re-run the Give Blood filter with the correct donor status.
  // `useFocusEffect(useCallback(…, []))` captures a stale closure — this corrects it.
  useEffect(() => {
    if (!phase5Loaded) return;
    if (dashMode !== 'give') return;
    if (__DEV__) console.log('[GiveBloodFilterFix] phase5 loaded — re-fetching with current donor status');
    doFetchRequests(bgRef.current, prRef.current);
  }, [phase5Loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blood bank users get their own dashboard
  if (user?.role === 'BLOOD_BANK') {
    return <BloodBankHome />;
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Emoji picker modal */}
      <Modal visible={showEmojiPicker} transparent animationType="fade" onRequestClose={() => setShowEmojiPicker(false)}>
        <TouchableOpacity style={styles.emojiOverlay} activeOpacity={1} onPress={() => setShowEmojiPicker(false)}>
          <View style={[styles.emojiSheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.emojiSheetTitle, { color: colors.text }]}>Choose your avatar</Text>
            <FlatList
              data={EMOJI_OPTIONS}
              keyExtractor={item => item}
              numColumns={4}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.emojiOption, { backgroundColor: colors.background }]} onPress={() => handlePickEmoji(item)}>
                  <Text style={styles.emojiOptionText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.logoRow}>
          <View style={styles.logoContainer}>
            <Ionicons name="water" size={32} color={Colors.light.primary} />
            <Ionicons name="add" size={16} color="#fff" style={styles.logoPlus} />
          </View>
          <Text style={[styles.logoText, { color: colors.text }]}>BloodLink</Text>
        </View>
        {/* Right: 😀 🌙 🔔 */}
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setShowEmojiPicker(true)} disabled={savingEmoji}>
            <Text style={styles.emojiAvatarText}>{displayEmoji}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} onPress={toggleTheme}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerIconBtn, styles.notificationBtn]} onPress={() => { setUnreadCount(0); router.push('/(modals)/notifications'); }}>
            <Ionicons name="notifications-outline" size={24} color={colors.icon} />
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Mode Switcher ── */}
        <View style={styles.modeSwitcherWrapper}>
          <View style={[styles.modeSwitcherPill, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={[styles.modeBtn, dashMode === 'give' && styles.modeBtnActive]}
              onPress={() => setDashMode('give')}
              activeOpacity={0.8}
            >
              <Ionicons name="heart" size={15} color={dashMode === 'give' ? '#fff' : colors.icon} />
              <Text style={[styles.modeBtnText, { color: dashMode === 'give' ? '#fff' : colors.muted }]}>Give Blood</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dashMode === 'find' && styles.modeBtnActive]}
              onPress={() => setDashMode('find')}
              activeOpacity={0.8}
            >
              <Ionicons name="search" size={15} color={dashMode === 'find' ? '#fff' : colors.icon} />
              <Text style={[styles.modeBtnText, { color: dashMode === 'find' ? '#fff' : colors.muted }]}>Find Blood</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── GIVE BLOOD MODE ── */}
        {dashMode === 'give' && (
          <>
            {/* Stats */}
            <View style={[styles.statsRow, { backgroundColor: colors.background }]}>
              <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
                  <FontAwesome5 name="heartbeat" size={18} color={Colors.light.primary} />
                </View>
                <View style={styles.statTextContainer}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>Lives Saved</Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>{totalDonations * 3} People</Text>
                </View>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
                  <Ionicons name="timer-outline" size={20} color={Colors.light.primary} />
                </View>
                <View style={styles.statTextContainer}>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>Next Eligible</Text>
                  <Text style={[styles.statValue, { color: colors.text }]}>{nextEligibleLabel}</Text>
                </View>
              </View>
            </View>

            {/* Blood Group Filters — all 8 types */}
            <View style={[styles.filtersWrapper, { backgroundColor: colors.background }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bloodGroupScroll}>
                <TouchableOpacity
                  style={[styles.bgFilterItem, selectedBloodGroup === null && styles.bgFilterItemActive]}
                  onPress={() => setSelectedBloodGroup(null)}
                >
                  <View style={[styles.bgIconBox, { backgroundColor: colors.surface }, selectedBloodGroup === null && styles.bgIconBoxActive]}>
                    <Ionicons name="grid" size={20} color={selectedBloodGroup === null ? '#fff' : Colors.light.primary} />
                  </View>
                  <Text style={[styles.bgFilterText, { color: colors.muted }, selectedBloodGroup === null && styles.bgFilterTextActive]}>All</Text>
                </TouchableOpacity>

                {ALL_BLOOD_GROUPS.map((bg) => (
                  <TouchableOpacity
                    key={bg}
                    style={[styles.bgFilterItem, selectedBloodGroup === bg && styles.bgFilterItemActive]}
                    onPress={() => toggleBloodGroup(bg)}
                  >
                    <View style={[styles.bgIconBox, { backgroundColor: colors.surface }, selectedBloodGroup === bg && styles.bgIconBoxActive]}>
                      <Ionicons name="water" size={22} color={selectedBloodGroup === bg ? '#fff' : Colors.light.primary} />
                      <Text style={[styles.bgIconText, selectedBloodGroup === bg ? { color: Colors.light.primary } : { color: '#fff' }]}>
                        {bg.includes('+') ? '+' : '-'}
                      </Text>
                    </View>
                    <Text style={[styles.bgFilterText, { color: colors.muted }, selectedBloodGroup === bg && styles.bgFilterTextActive]}>{bg}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Action Row: Donor card (conditional) + Request Blood card (always visible) */}
            <View style={styles.actionRow}>
              {donorVariant === 'active' && (
                <TouchableOpacity
                  style={[styles.actionCard, styles.actionCardGreen]}
                  activeOpacity={0.8}
                  onPress={() => router.push('/(modals)/donate-blood')}
                >
                  <FontAwesome5 name="hand-holding-heart" size={26} color="#fff" />
                  <Text style={styles.actionCardTitle}>Active Donor</Text>
                  <Text style={styles.actionCardSub}>Ready to donate</Text>
                  <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.8)" style={{ position: 'absolute', top: 10, right: 10 }} />
                </TouchableOpacity>
              )}

              {donorVariant === 'pending' && (
                <View style={[styles.actionCard, styles.actionCardDisabled, { backgroundColor: colors.surface, borderColor: colors.border }]} pointerEvents="none">
                  <Ionicons name="time-outline" size={26} color="#E67E22" />
                  <Text style={[styles.actionCardTitle, { color: '#E67E22' }]}>Under Review</Text>
                  <Text style={[styles.actionCardSub, { color: colors.muted }]}>Pending approval</Text>
                </View>
              )}

              {donorVariant === 'deferred' && (
                <TouchableOpacity
                  style={[styles.actionCard, styles.actionCardOrange]}
                  activeOpacity={0.8}
                  onPress={() => router.push('/(modals)/donate-blood')}
                >
                  <Ionicons name="timer-outline" size={26} color="#fff" />
                  <Text style={styles.actionCardTitle}>
                    {donorStatusData?.daysRemaining != null ? `${donorStatusData.daysRemaining}d Left` : 'Deferred'}
                  </Text>
                  <Text style={styles.actionCardSub}>Tap for details</Text>
                </TouchableOpacity>
              )}

              {donorVariant === 'ineligible' && (
                <TouchableOpacity
                  style={[styles.actionCard, styles.actionCardRed]}
                  activeOpacity={0.8}
                  onPress={() => router.push('/(modals)/donate-blood')}
                >
                  <Ionicons name="close-circle-outline" size={26} color="#fff" />
                  <Text style={styles.actionCardTitle}>Not Eligible</Text>
                  <Text style={styles.actionCardSub}>Tap for details</Text>
                </TouchableOpacity>
              )}

              {donorVariant === 'register' && (
                <TouchableOpacity
                  style={[styles.actionCard, styles.actionCardRed]}
                  activeOpacity={0.8}
                  onPress={() => router.push('/(modals)/donate-blood')}
                >
                  <FontAwesome5 name="hand-holding-heart" size={26} color="#fff" />
                  <Text style={styles.actionCardTitle}>Donate Blood</Text>
                  <Text style={styles.actionCardSub}>Become a donor</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionCard, styles.actionCardBlue]}
                activeOpacity={0.8}
                onPress={() => router.navigate('/(tabs)/request')}
              >
                <Ionicons name="water-outline" size={26} color="#fff" />
                <Text style={styles.actionCardTitle}>Request Blood</Text>
                <Text style={styles.actionCardSub}>Find donors near you</Text>
              </TouchableOpacity>
            </View>

            {/* Section Header */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>All Near You</Text>
            </View>

            {/* Priority sub-filters */}
            <View style={[styles.priorityRow, { backgroundColor: colors.background }]}>
              {PRIORITY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={String(opt.value)}
                  style={[styles.priorityChip, { backgroundColor: colors.surface }, selectedPriority === opt.value && styles.priorityChipActive]}
                  onPress={() => setSelectedPriority(opt.value)}
                >
                  <Text style={[styles.priorityText, { color: colors.muted }, selectedPriority === opt.value && styles.priorityTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Requests Feed */}
            <View style={styles.requestsContainer}>
              {loadingRequests ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator size="small" color={Colors.light.primary} />
                  <Text style={[styles.loadingText, { color: colors.muted }]}>Loading requests...</Text>
                </View>
              ) : requestError ? (
                <TouchableOpacity style={styles.errorState} onPress={() => doFetchRequests(selectedBloodGroup, selectedPriority)}>
                  <Ionicons name="alert-circle-outline" size={32} color="#E74C3C" />
                  <Text style={[styles.errorText, { color: colors.text }]}>Something went wrong.</Text>
                  <Text style={[styles.retryText, { color: colors.muted }]}>Tap to retry</Text>
                </TouchableOpacity>
              ) : emergencyRequests.filter(r => !acceptedRequestIds.has(r.id)).length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="water-outline" size={44} color={colors.border} />
                  <Text style={[styles.emptyText, { color: colors.muted }]}>No blood requests matching your filters</Text>
                </View>
              ) : (
                emergencyRequests.filter(r => !acceptedRequestIds.has(r.id)).map((req) => {
                  const badge = getEmergencyBadge(req.emergencyLevel);
                  const requesterName = req.requesterName || req.name || 'User';
                  const hospitalName = req.hospitalName || req.hospital || 'Unknown Hospital';
                  const timeStr = req.createdAt ? timeAgo(req.createdAt) : (req.time || '');
                  const donorBg: string | undefined = (user as any)?.bloodGroup;
                  const isCompatible = isActiveDonor &&
                    (!donorBg || (BLOOD_GROUP_COMPATIBILITY[req.bloodGroup]?.includes(donorBg) ?? true));
                  return (
                    <View key={req.id} style={[styles.urgentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.urgentCardHeader}>
                        <View style={[styles.urgentBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.urgentBadgeText, { color: badge.color }]}>{badge.label}</Text>
                        </View>
                        <Text style={[styles.timeText, { color: colors.muted }]}>{timeStr}</Text>
                      </View>

                      <Text style={[styles.requestTitle, { color: colors.text }]}>{req.bloodGroup} Blood Needed</Text>

                      <View style={styles.requestDetailsRow}>
                        <View style={styles.requestDetailsLeft}>
                          <Text style={[styles.requestedByLabel, { color: colors.muted }]}>Requested by</Text>
                          <View style={styles.requesterRow}>
                            <Ionicons name="person-outline" size={16} color={colors.icon} />
                            <Text style={[styles.requesterName, { color: colors.text }]}>{requesterName}</Text>
                            <Ionicons name="checkmark-circle" size={16} color={Colors.light.primary} style={{ marginLeft: 4 }} />
                          </View>

                          <View style={styles.infoRow}>
                            <Ionicons name="business-outline" size={16} color={colors.icon} />
                            <Text style={[styles.infoText, { color: colors.muted }]} numberOfLines={1}>{hospitalName}</Text>
                          </View>

                          {req.units > 0 && (
                            <View style={styles.infoRow}>
                              <Ionicons name="flask-outline" size={16} color={colors.icon} />
                              <Text style={[styles.infoText, { color: colors.muted }]}>{req.units} unit{req.units !== 1 ? 's' : ''} needed</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.hugeDropContainer}>
                          <Ionicons name="water" size={90} color={Colors.light.primary} />
                          <Text style={styles.hugeDropText}>{req.bloodGroup}</Text>
                        </View>
                      </View>

                      <View style={styles.requestActions}>
                        <TouchableOpacity style={[styles.rejectBtn, { borderColor: colors.border, backgroundColor: colors.surface }]} onPress={() => handleAction('Reject', req.id)}>
                          <Text style={[styles.rejectBtnText, { color: colors.muted }]}>Ignore</Text>
                        </TouchableOpacity>
                        {isCompatible ? (
                          <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAction('Accept', req.id)}>
                            <Text style={styles.acceptBtnText}>Accept</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.acceptBtn, styles.incompatibleBtn]}>
                            <Text style={styles.incompatibleBtnText}>Not compatible</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        {/* ── FIND BLOOD MODE ── */}
        {dashMode === 'find' && (
          <>
            {/* Section Header */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Find Compatible Blood</Text>
            </View>

            {/* Tabs: Compatible Donors | Blood Banks */}
            <View style={[styles.tabRow, { backgroundColor: colors.background }]}>
              <TouchableOpacity
                style={[styles.tabChip, { backgroundColor: colors.surface }, activeTab === 'donors' && styles.tabChipActive]}
                onPress={() => setActiveTab('donors')}
              >
                <Ionicons name="people-outline" size={16} color={activeTab === 'donors' ? '#fff' : colors.icon} style={{ marginRight: 5 }} />
                <Text style={[styles.tabText, { color: colors.muted }, activeTab === 'donors' && styles.tabTextActive]}>Compatible Donors</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabChip, { backgroundColor: colors.surface }, activeTab === 'banks' && styles.tabChipActive]}
                onPress={() => setActiveTab('banks')}
              >
                <Ionicons name="medical-outline" size={16} color={activeTab === 'banks' ? '#fff' : colors.icon} style={{ marginRight: 5 }} />
                <Text style={[styles.tabText, { color: colors.muted }, activeTab === 'banks' && styles.tabTextActive]}>Blood Banks</Text>
              </TouchableOpacity>
            </View>

            {/* Feed Content */}
            <View style={styles.requestsContainer}>

              {/* Compatible Donors Tab */}
              {activeTab === 'donors' && (
                loadingDonors ? (
                  <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                    <Text style={[styles.loadingText, { color: colors.muted }]}>Finding donors near you...</Text>
                  </View>
                ) : donorNoBg ? (
                  <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
                    <Ionicons name="water-outline" size={48} color={Colors.light.primary} style={{ opacity: 0.5 }} />
                    <Text style={[styles.emptyText, { color: colors.text }]}>Select a blood group to find compatible donors</Text>
                    <Text style={[styles.emptySubText, { color: colors.muted }]}>Go to your profile and add your blood group to see donors who can help you.</Text>
                    <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)} style={{ marginTop: 4, paddingVertical: 8, paddingHorizontal: 20, backgroundColor: Colors.light.primary, borderRadius: 20 }}>
                      <Text style={{ color: '#fff', fontFamily: 'Poppins_600SemiBold', fontSize: 13 }}>Update Profile</Text>
                    </TouchableOpacity>
                  </View>
                ) : donorError ? (
                  <TouchableOpacity style={styles.errorState} onPress={doFetchDonors}>
                    <Ionicons name="alert-circle-outline" size={32} color="#E74C3C" />
                    <Text style={[styles.errorText, { color: colors.text }]}>Could not load donors.</Text>
                    <Text style={[styles.retryText, { color: colors.muted }]}>Tap to retry</Text>
                  </TouchableOpacity>
                ) : nearbyDonors.length === 0 ? (
                  <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
                    <Ionicons name="people-outline" size={48} color={colors.border} />
                    <Text style={[styles.emptyText, { color: colors.text }]}>No compatible donors currently available in your area</Text>
                    <Text style={[styles.emptySubText, { color: colors.muted }]}>Enable location for better results, or request blood directly.</Text>
                  </View>
                ) : (
                  nearbyDonors.map((donor) => (
                    <View key={donor.id} style={[styles.urgentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.urgentCardHeader}>
                        <View style={[styles.urgentBadge, { backgroundColor: colors.surface }]}>
                          <Text style={{ color: Colors.light.primary, fontSize: 12, fontFamily: 'Poppins_600SemiBold' }}>{donor.bloodGroup}</Text>
                        </View>
                        {donor.canRequestBlood === true && (
                          <View style={[styles.urgentBadge, { backgroundColor: '#EAFAF1' }]}>
                            <Text style={{ color: '#27AE60', fontSize: 11, fontFamily: 'Poppins_500Medium' }}>Available</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.requestDetailsRow}>
                        <View style={styles.requestDetailsLeft}>
                          <View style={styles.requesterRow}>
                            <Text style={{ fontSize: 22, marginRight: 8 }}>🩸</Text>
                            <Text style={[styles.requesterName, { color: colors.text }]}>{donor.name}</Text>
                          </View>
                          {(donor.gender || donor.age) && (
                            <View style={styles.infoRow}>
                              <Ionicons name="person-outline" size={14} color={colors.icon} />
                              <Text style={[styles.infoText, { color: colors.muted }]}>
                                {[
                                  donor.gender ? (donor.gender.charAt(0).toUpperCase() + donor.gender.slice(1)) : null,
                                  donor.age ? `${donor.age} yrs` : null,
                                ].filter(Boolean).join(' · ')}
                              </Text>
                            </View>
                          )}
                          {donor.location?.address && donor.location.address !== donor.location.city && (
                            <View style={styles.infoRow}>
                              <Ionicons name="map-outline" size={14} color={colors.icon} />
                              <Text style={[styles.infoText, { color: colors.muted }]}>{donor.location.address}</Text>
                            </View>
                          )}
                          {donor.location?.city && (
                            <View style={styles.infoRow}>
                              <Ionicons name="location-outline" size={14} color={colors.icon} />
                              <Text style={[styles.infoText, { color: colors.muted }]}>{donor.location.city}{donor.location.state ? `, ${donor.location.state}` : ''}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.hugeDropContainer}>
                          <Ionicons name="water" size={70} color={Colors.light.primary} />
                          <Text style={styles.hugeDropText}>{donor.bloodGroup}</Text>
                        </View>
                      </View>

                      <View style={styles.requestActions}>
                        {(() => {
                          // Backend is the single source of truth (canRequestBlood + availabilityLabel).
                          const canRequest = donor.canRequestBlood === true;
                          const label = donor.availabilityLabel ?? 'Contact Pending';
                          if (canRequest) {
                            return (
                              <TouchableOpacity
                                style={[styles.acceptBtn, { marginLeft: 0, flexDirection: 'row', justifyContent: 'center' }]}
                                onPress={() => {
                                  console.log('[TargetedRequestUI] selected donorId:', donor.id);
                                  console.log('[TargetedRequestUI] selected donorName:', donor.name);
                                  router.push(
                                    `/(tabs)/request?targetDonorId=${encodeURIComponent(donor.id)}&targetDonorName=${encodeURIComponent(donor.name)}&targetDonorBloodGroup=${encodeURIComponent(donor.bloodGroup)}` as any
                                  );
                                }}
                              >
                                <Ionicons name="water-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                                <Text style={styles.acceptBtnText}>Request Blood</Text>
                              </TouchableOpacity>
                            );
                          }
                          return (
                            <View style={[styles.acceptBtn, { marginLeft: 0, flexDirection: 'row', justifyContent: 'center', opacity: 0.45 }]}>
                              <Ionicons name="time-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                              <Text style={styles.acceptBtnText}>{label}</Text>
                            </View>
                          );
                        })()}
                      </View>
                    </View>
                  ))
                )
              )}

              {/* Blood Banks Tab */}
              {activeTab === 'banks' && (
                loadingBanks ? (
                  <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                    <Text style={[styles.loadingText, { color: colors.muted }]}>Loading blood banks...</Text>
                  </View>
                ) : bankError ? (
                  <TouchableOpacity style={styles.errorState} onPress={doFetchBanks}>
                    <Ionicons name="alert-circle-outline" size={32} color="#E74C3C" />
                    <Text style={[styles.errorText, { color: colors.text }]}>Something went wrong.</Text>
                    <Text style={[styles.retryText, { color: colors.muted }]}>Tap to retry</Text>
                  </TouchableOpacity>
                ) : bloodBanks.length === 0 ? (
                  <>
                    <View style={[styles.verifiedBanner, { backgroundColor: colors.surface }]}>
                      <Ionicons name="shield-checkmark-outline" size={14} color="#2E86C1" />
                      <Text style={[styles.verifiedBannerText, { color: colors.muted }]}>Showing verified blood banks actively managed by our community partners.</Text>
                    </View>
                    <View style={styles.emptyState}>
                      <Ionicons name="medical-outline" size={44} color={colors.border} />
                      <Text style={[styles.emptyText, { color: colors.muted }]}>No verified banks nearby</Text>
                      <Text style={[styles.emptySubText, { color: colors.muted }]}>Only banks that are verified and actively managed are shown here.</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={[styles.verifiedBanner, { backgroundColor: colors.surface }]}>
                      <Ionicons name="shield-checkmark-outline" size={14} color="#2E86C1" />
                      <Text style={[styles.verifiedBannerText, { color: colors.muted }]}>Showing verified blood banks actively managed by our community partners.</Text>
                    </View>
                    {bloodBanks.map((bank) => (
                      <TouchableOpacity
                        key={bank.id}
                        style={[styles.bankCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => router.push(`/blood-bank/${bank.id}` as any)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.bankCardTop}>
                          <View style={styles.bankCardLeft}>
                            <View style={[styles.bankIconBox, { backgroundColor: colors.surface }]}>
                              <Ionicons name="medical" size={22} color={Colors.light.primary} />
                            </View>
                            <View style={styles.bankCardInfo}>
                              <Text style={[styles.bankCardName, { color: colors.text }]} numberOfLines={1}>{bank.name}</Text>
                              {bank.location && (
                                <Text style={[styles.bankCardAddress, { color: colors.muted }]} numberOfLines={2}>
                                  {bank.location.address || `${bank.location.city}, ${bank.location.state}`}
                                </Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.bankCardRight}>
                            {bank.distance !== undefined && (
                              <Text style={[styles.bankDistance, { color: colors.muted }]}>{bank.distance.toFixed(1)} km</Text>
                            )}
                            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                          </View>
                        </View>

                        <View style={styles.bankCardMeta}>
                          {bank.phone && (
                            <View style={styles.bankMetaItem}>
                              <Ionicons name="call-outline" size={13} color={colors.icon} />
                              <Text style={[styles.bankMetaText, { color: colors.muted }]}>{bank.phone}</Text>
                            </View>
                          )}
                          {bank.operatingHours && (
                            <View style={styles.bankMetaItem}>
                              <Ionicons name="time-outline" size={13} color={colors.icon} />
                              <Text style={[styles.bankMetaText, { color: colors.muted }]}>{bank.operatingHours}</Text>
                            </View>
                          )}
                        </View>

                        {bank.availableBloodGroups && bank.availableBloodGroups.length > 0 && (
                          <View style={styles.bankStockRow}>
                            <Text style={[styles.bankStockLabel, { color: colors.muted }]}>Available: </Text>
                            {bank.availableBloodGroups.slice(0, 6).map(bg => (
                              <View key={bg} style={[styles.bankStockBadge, { backgroundColor: colors.surface }]}>
                                <Text style={[styles.bankStockText, { color: colors.text }]}>{bg}</Text>
                              </View>
                            ))}
                            {bank.availableBloodGroups.length > 6 && (
                              <Text style={[styles.bankStockMore, { color: colors.muted }]}>+{bank.availableBloodGroups.length - 6}</Text>
                            )}
                          </View>
                        )}

                        {bank.isVerified && (
                          <View style={styles.bankVerifiedRow}>
                            <Ionicons name="checkmark-circle" size={12} color="#2ECC71" />
                            <Text style={styles.bankVerifiedText}>Verified</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )
              )}

            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Blood Bank Home Dashboard ───────────────────────────────────────────────
// Rendered when user.role === 'BLOOD_BANK'. Fully self-contained component.
function BloodBankHome() {
  const { colors, isDark, toggleTheme } = useTheme();
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(state => state.setUser);
  const router = useRouter();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [savingEmoji, setSavingEmoji] = useState(false);
  const [bankStats, setBankStats] = useState<BankWithStats | null>(null);
  const [pendingReqs, setPendingReqs] = useState<BankRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const displayEmoji = user?.profileEmoji ?? '🏥';

  const handlePickEmoji = async (emoji: string) => {
    setShowEmojiPicker(false);
    setSavingEmoji(true);
    try {
      const res = await authService.updateEmoji(emoji);
      if (res.success && res.data) setUser(res.data);
    } catch {
      Alert.alert('Error', 'Could not save emoji. Please try again.');
    } finally {
      setSavingEmoji(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        setLoading(true);
        try {
          const [banksRes, reqsRes, notifRes] = await Promise.allSettled([
            bloodBankService.getMyBanks(),
            bloodBankService.getMyBankRequests(),
            notificationService.getUnreadCount(),
          ]);
          if (!active) return;
          if (banksRes.status === 'fulfilled' && banksRes.value.success && banksRes.value.data?.length) {
            setBankStats(banksRes.value.data[0]);
          }
          if (reqsRes.status === 'fulfilled' && reqsRes.value.success) {
            const open = (reqsRes.value.data ?? []).filter(r => r.status === 'OPEN' || r.status === 'PENDING').slice(0, 5);
            setPendingReqs(open);
          }
          if (notifRes.status === 'fulfilled') {
            setUnreadCount((notifRes.value as any)?.data?.count ?? 0);
          }
        } finally {
          if (active) setLoading(false);
        }
      };
      load();
      return () => { active = false; };
    }, [])
  );

  const hasBank = !!bankStats;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Emoji picker modal */}
      <Modal visible={showEmojiPicker} transparent animationType="fade" onRequestClose={() => setShowEmojiPicker(false)}>
        <TouchableOpacity style={styles.emojiOverlay} activeOpacity={1} onPress={() => setShowEmojiPicker(false)}>
          <View style={[styles.emojiSheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.emojiSheetTitle, { color: colors.text }]}>Choose your avatar</Text>
            <FlatList
              data={EMOJI_OPTIONS}
              keyExtractor={item => item}
              numColumns={4}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.emojiOption, { backgroundColor: colors.background }]} onPress={() => handlePickEmoji(item)}>
                  <Text style={styles.emojiOptionText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header — same style as donor home */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.logoRow}>
          <View style={styles.logoContainer}>
            <Ionicons name="water" size={32} color={Colors.light.primary} />
            <Ionicons name="add" size={16} color="#fff" style={styles.logoPlus} />
          </View>
          <Text style={[styles.logoText, { color: colors.text }]}>BloodLink</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setShowEmojiPicker(true)} disabled={savingEmoji}>
            <Text style={styles.emojiAvatarText}>{displayEmoji}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} onPress={toggleTheme}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerIconBtn, styles.notificationBtn]} onPress={() => { setUnreadCount(0); router.push('/(modals)/notifications'); }}>
            <Ionicons name="notifications-outline" size={24} color={colors.icon} />
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Bank identity card */}
        {hasBank ? (
          <View style={[styles.bankDashCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.bankDashRow}>
              <View style={[styles.bankDashIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="medical" size={28} color={Colors.light.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.bankDashName, { color: colors.text }]} numberOfLines={2}>{bankStats!.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}>
                  {bankStats!.isVerified ? (
                    <View style={styles.verifiedChip}>
                      <Ionicons name="shield-checkmark" size={12} color="#fff" />
                      <Text style={styles.verifiedChipText}>Verified</Text>
                    </View>
                  ) : (
                    <View style={[styles.verifiedChip, { backgroundColor: '#E67E22' }]}>
                      <Ionicons name="time-outline" size={12} color="#fff" />
                      <Text style={styles.verifiedChipText}>Pending</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Stats row */}
            <View style={[styles.bankStatRow, { borderTopColor: colors.border }]}>
              <View style={styles.bankStatCell}>
                <Text style={[styles.bankStatNum, { color: Colors.light.primary }]}>{bankStats!.inventoryUnits ?? 0}</Text>
                <Text style={[styles.bankStatLabel, { color: colors.muted }]}>Units</Text>
              </View>
              <View style={[styles.bankStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.bankStatCell}>
                <Text style={[styles.bankStatNum, { color: '#E67E22' }]}>{bankStats!.pendingRequests ?? 0}</Text>
                <Text style={[styles.bankStatLabel, { color: colors.muted }]}>Pending</Text>
              </View>
              <View style={[styles.bankStatDivider, { backgroundColor: colors.border }]} />
              <View style={styles.bankStatCell}>
                <Text style={[styles.bankStatNum, { color: '#27AE60' }]}>{bankStats!.fulfilledRequests ?? 0}</Text>
                <Text style={[styles.bankStatLabel, { color: colors.muted }]}>Fulfilled</Text>
              </View>
            </View>
          </View>
        ) : !loading ? (
          <TouchableOpacity
            style={[styles.bankDashCard, styles.bankDashSetupCard, { backgroundColor: colors.card, borderColor: Colors.light.primary }]}
            onPress={() => router.push('/blood-bank/my-bank')}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={32} color={Colors.light.primary} />
            <Text style={[styles.bankDashSetupTitle, { color: Colors.light.primary }]}>Set Up Your Blood Bank</Text>
            <Text style={[styles.bankDashSetupSub, { color: colors.muted }]}>Register your bank to start managing inventory and requests</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.bankDashCard, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', padding: 30 }]}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.bankActionsGrid}>
          <TouchableOpacity style={[styles.bankActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/blood-bank/inventory')} activeOpacity={0.8}>
            <View style={[styles.bankActionIcon, { backgroundColor: '#FDEDEC' }]}>
              <Ionicons name="flask" size={22} color={Colors.light.primary} />
            </View>
            <Text style={[styles.bankActionLabel, { color: colors.text }]}>Inventory</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bankActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/blood-bank/bank-manage')} activeOpacity={0.8}>
            <View style={[styles.bankActionIcon, { backgroundColor: '#EBF5FB' }]}>
              <Ionicons name="document-text" size={22} color="#2980B9" />
            </View>
            <Text style={[styles.bankActionLabel, { color: colors.text }]}>Requests</Text>
            {bankStats && bankStats.pendingRequests > 0 && (
              <View style={styles.bankActionBadge}>
                <Text style={styles.bankActionBadgeText}>{bankStats.pendingRequests}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bankActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(tabs)/inbox')} activeOpacity={0.8}>
            <View style={[styles.bankActionIcon, { backgroundColor: '#EAFAF1' }]}>
              <Ionicons name="chatbubbles" size={22} color="#27AE60" />
            </View>
            <Text style={[styles.bankActionLabel, { color: colors.text }]}>Messages</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.bankActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/blood-bank/my-bank')} activeOpacity={0.8}>
            <View style={[styles.bankActionIcon, { backgroundColor: '#F5EEF8' }]}>
              <Ionicons name="person-circle" size={22} color="#8E44AD" />
            </View>
            <Text style={[styles.bankActionLabel, { color: colors.text }]}>Bank Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Pending incoming requests */}
        {pendingReqs.length > 0 && (
          <>
            <View style={styles.bankSectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Incoming Requests</Text>
              <TouchableOpacity onPress={() => router.push('/blood-bank/bank-manage')}>
                <Text style={{ color: Colors.light.primary, fontFamily: 'Poppins_500Medium', fontSize: 13 }}>See all</Text>
              </TouchableOpacity>
            </View>
            {pendingReqs.map(req => (
              <TouchableOpacity
                key={req.id}
                style={[styles.urgentCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push('/blood-bank/bank-manage')}
                activeOpacity={0.85}
              >
                <View style={styles.urgentCardHeader}>
                  <View style={[styles.urgentBadge, { backgroundColor: '#EBF5FB' }]}>
                    <Text style={{ color: '#2980B9', fontSize: 12, fontFamily: 'Poppins_600SemiBold' }}>{req.bloodGroup}</Text>
                  </View>
                  <Text style={[styles.timeText, { color: colors.muted }]}>{req.units} units</Text>
                </View>
                <View style={styles.requesterRow}>
                  <Ionicons name="person-outline" size={15} color={colors.icon} />
                  <Text style={[styles.requesterName, { color: colors.text, marginLeft: 6 }]}>{req.requester?.name ?? 'Unknown'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Ionicons name="alert-circle-outline" size={14} color={colors.icon} />
                  <Text style={[styles.infoText, { color: colors.muted }]}>{req.emergencyLevel}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* No bank yet — empty pending state */}
        {!loading && hasBank && pendingReqs.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={44} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.muted }]}>No pending requests</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  logoPlus: {
    position: 'absolute',
    top: 8,
    left: 8,
  },
  logoText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#111',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiAvatarText: {
    fontSize: 20,
  },
  emojiOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiSheet: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: 280,
  },
  emojiSheetTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
  },
  emojiOption: {
    flex: 1,
    margin: 6,
    height: 56,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiOptionText: {
    fontSize: 28,
  },
  notificationBtn: {
    position: 'relative',
    padding: 5,
  },
  notificationBadge: {
    position: 'absolute',
    top: 2,
    right: 4,
    backgroundColor: Colors.light.primary,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Poppins_700Bold',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 25,
  },
  statBox: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    width: '48%',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: '#F5F5F5',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statTextContainer: {
    marginLeft: 10,
    flex: 1,
  },
  statLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 10,
    color: '#888',
  },
  statValue: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: '#333',
    marginTop: 2,
  },
  daysBold: {
    color: Colors.light.primary,
  },
  filtersWrapper: {
    marginBottom: 30,
  },
  bloodGroupScroll: {
    paddingHorizontal: 20,
    gap: 15,
  },
  bgFilterItem: {
    alignItems: 'center',
  },
  bgFilterItemActive: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 15,
    paddingVertical: 15,
    borderRadius: 20,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  bgIconBox: {
    width: 50,
    height: 50,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0F0F0',
    marginBottom: 8,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  bgIconBoxActive: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
    marginBottom: 4,
  },
  bgIconText: {
    position: 'absolute',
    fontFamily: 'Poppins_700Bold',
    fontSize: 10,
    top: 18,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  bgFilterText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#333',
  },
  bgFilterTextActive: {
    color: '#fff',
  },
  // ─── Mode Switcher ────────────────────────────────────────────────────────
  modeSwitcherWrapper: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    alignItems: 'center',
  },
  modeSwitcherPill: {
    flexDirection: 'row',
    borderRadius: 28,
    padding: 4,
    gap: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 22,
    gap: 7,
  },
  modeBtnActive: {
    backgroundColor: Colors.light.primary,
    elevation: 4,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  modeBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
  },
  // ─── Action Row ───────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 25,
    gap: 12,
  },
  actionCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 108,
    elevation: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  actionCardTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 18,
  },
  actionCardSub: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 10,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
  },
  actionCardGreen: {
    backgroundColor: '#27AE60',
    shadowColor: '#27AE60',
  },
  actionCardRed: {
    backgroundColor: Colors.light.primary,
    shadowColor: Colors.light.primary,
  },
  actionCardOrange: {
    backgroundColor: '#E67E22',
    shadowColor: '#E67E22',
  },
  actionCardBlue: {
    backgroundColor: '#2980B9',
    shadowColor: '#2980B9',
  },
  actionCardDisabled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#E8E8E8',
    elevation: 0,
    shadowOpacity: 0,
  },

  // Legacy hero button styles (kept for reference — no longer rendered)
  activeDonorBtn: {
    backgroundColor: '#27AE60',
    shadowColor: '#27AE60',
  },
  donateHeroBtn: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 25,
    paddingVertical: 20,
    borderRadius: 20,
    elevation: 8,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    marginHorizontal: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  donateContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  donateTexts: {
    marginLeft: 15,
  },
  donateHeroText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#fff',
    lineHeight: 28,
  },
  donateSubText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  sectionHeaderRow: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#222',
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 10,
  },
  tabChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  tabChipActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  tabText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#666',
  },
  tabTextActive: {
    color: '#fff',
  },
  priorityRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 14,
    gap: 8,
  },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  priorityChipActive: {
    backgroundColor: '#FFF3E0',
    borderColor: '#E67E22',
  },
  priorityText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#666',
  },
  priorityTextActive: {
    color: '#E67E22',
    fontFamily: 'Poppins_600SemiBold',
  },
  requestsContainer: {
    paddingHorizontal: 20,
  },
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 10,
  },
  loadingText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#888',
  },
  errorState: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: '#FFF9F9',
    borderRadius: 16,
    gap: 6,
  },
  errorText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#555',
  },
  retryText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: Colors.light.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    borderRadius: 16,
    gap: 10,
    minHeight: 180,
  },
  emptyText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  emptySubText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#bbb',
    textAlign: 'center',
    lineHeight: 18,
  },
  verifiedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EBF5FB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#AED6F1',
  },
  verifiedBannerText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#2E86C1',
    flex: 1,
    lineHeight: 17,
  },
  urgentCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#F5F5F5',
  },
  urgentCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  urgentBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  urgentBadgeText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 11,
  },
  timeText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#999',
  },
  requestTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#111',
    marginBottom: 15,
  },
  requestDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  requestDetailsLeft: {
    flex: 1,
    marginRight: 10,
  },
  requestedByLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  requesterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  requesterName: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#222',
    marginLeft: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#555',
    marginLeft: 8,
    flex: 1,
  },
  hugeDropContainer: {
    width: 90,
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginTop: -10,
  },
  hugeDropText: {
    position: 'absolute',
    color: '#fff',
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    top: 32,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  requestActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 15,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#EAEAEA',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  rejectBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#666',
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: Colors.light.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginLeft: 8,
    elevation: 3,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  acceptBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#fff',
  },
  incompatibleBtn: {
    backgroundColor: '#EAEAEA',
    elevation: 0,
    shadowOpacity: 0,
  },
  incompatibleBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#999',
  },
  bankCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#F5F5F5',
  },
  bankCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  bankCardLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  bankIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bankCardInfo: { flex: 1 },
  bankCardName: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#222',
    marginBottom: 3,
  },
  bankCardAddress: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
  },
  bankCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  bankDistance: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: Colors.light.primary,
  },
  bankCardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
    paddingLeft: 56,
  },
  bankMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bankMetaText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#666',
  },
  bankStockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 56,
    marginBottom: 6,
  },
  bankStockLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: '#888',
  },
  bankStockBadge: {
    backgroundColor: '#FDEDEC',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  bankStockText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: Colors.light.primary,
  },
  bankStockMore: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: '#888',
  },
  bankVerifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 56,
    gap: 4,
  },
  bankVerifiedText: {
    fontFamily: 'Poppins_500Medium',
  },
  // ─── Bank Dashboard Styles ───────────────────────────────────────────────────
  bankDashCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bankDashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  bankDashIcon: {
    width: 54,
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankDashName: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    lineHeight: 22,
  },
  bankStatRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  bankStatCell: {
    flex: 1,
    alignItems: 'center',
  },
  bankStatDivider: {
    width: 1,
  },
  bankStatNum: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
  },
  bankStatLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  bankDashSetupCard: {
    alignItems: 'center',
    padding: 28,
    borderStyle: 'dashed',
    gap: 8,
  },
  bankDashSetupTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
  },
  bankDashSetupSub: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    textAlign: 'center',
  },
  bankActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  bankActionBtn: {
    width: '46%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  bankActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankActionLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
  },
  bankActionBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: Colors.light.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  bankActionBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#27AE60',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  verifiedChipText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
  },
  bankSectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11,
    color: '#2ECC71',
  },
});
