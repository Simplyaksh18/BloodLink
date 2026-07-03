import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import * as ImagePicker from 'expo-image-picker';
import { userStorage } from '../../services/apiClient';
import { useRouter, useFocusEffect } from 'expo-router';
import { getUserDisplayRole, getUserRoleColor } from '../../utils/roleHelpers';
import { authService } from '../../services/authService';
import { verificationService, VerificationStatusResponse } from '../../services/verificationService';
import { donorStatusService } from '../../services/donorStatusService';
import { DonorStatusData, DonorStatus } from '../../types';
import { bloodBankService, BankWithStats, InventoryItem } from '../../services/bloodService';

// ─── Bank Profile View ────────────────────────────────────────────────────────
function BankProfileView() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user, logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [bank, setBank] = useState<BankWithStats | null>(null);
  const [inventoryUnits, setInventoryUnits] = useState(0);
  const [bloodGroupsAvailable, setBloodGroupsAvailable] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [fulfilledCount, setFulfilledCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        setLoading(true);
        try {
          const [banksRes, reqsRes, invRes] = await Promise.allSettled([
            bloodBankService.getMyBanks(),
            bloodBankService.getMyBankRequests(),
            bloodBankService.getMyInventory(),
          ]);
          if (!active) return;
          if (banksRes.status === 'fulfilled' && banksRes.value.success && banksRes.value.data?.length) {
            const b = banksRes.value.data[0];
            setBank(b);
            console.log('[BankProfile] loaded bank:', b.name, 'id:', b.id);
            console.log('[ProfileEmoji] loaded:', user?.profileEmoji ?? '🏥');
          }
          if (reqsRes.status === 'fulfilled' && reqsRes.value.success) {
            const reqs = reqsRes.value.data ?? [];
            setPendingCount(reqs.filter((r: any) => r.status === 'OPEN' || r.status === 'ACTIVE').length);
            setFulfilledCount(reqs.filter((r: any) => r.status === 'FULFILLED').length);
            console.log('[BankRequests] count:', reqs.length);
          }
          if (invRes.status === 'fulfilled' && invRes.value.success) {
            const items: InventoryItem[] = invRes.value.data ?? [];
            setInventoryUnits(items.filter(i => i.status === 'ACTIVE').reduce((s, i) => s + (i.units ?? 0), 0));
            setBloodGroupsAvailable(new Set(items.filter(i => i.status === 'ACTIVE' && i.units > 0).map(i => i.bloodGroup)).size);
          }
        } finally {
          if (active) setLoading(false);
        }
      };
      load();
      return () => { active = false; };
    }, [])
  );

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const bankId = bank?.id;
  const navTo = (path: string) => {
    console.log('[BankRoute] navigating:', path);
    router.push(path as any);
  };

  const contactPhone = (bank as any)?.contactPhone ?? bank?.phone;
  const vStatus = (bank as any)?.verificationStatus ?? (bank?.isVerified ? 'VERIFIED' : 'PENDING_REVIEW');
  const isVerified = bank?.isVerified || vStatus === 'VERIFIED';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={{ width: 44 }} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Bank Profile</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.settingsBtn}>
          <Ionicons name="log-out-outline" size={22} color="#E74C3C" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

          {/* ── Hero card ────────────────────────────────────────── */}
          <View style={bp.heroCard}>
            <View style={bp.heroBg} />
            <View style={bp.heroContent}>
              {(() => { console.log('[BankEmoji] using:', user?.profileEmoji ?? '🏥'); return null; })()}
              <View style={bp.iconRing}>
                <Text style={bp.heroEmoji}>{user?.profileEmoji ?? '🏥'}</Text>
              </View>
              <Text style={bp.heroName} numberOfLines={2}>
                {bank?.name ?? user?.name ?? 'Blood Bank'}
              </Text>
              {bank?.location && (
                <Text style={bp.heroLocation}>
                  {[bank.location.city, bank.location.state].filter(Boolean).join(', ')}
                </Text>
              )}
              <View style={[bp.verifiedChip, { backgroundColor: isVerified ? '#27AE60' : '#E67E22' }]}>
                <Ionicons name={isVerified ? 'shield-checkmark' : 'time-outline'} size={12} color="#fff" />
                <Text style={bp.verifiedText}>{isVerified ? 'Verified Bank' : 'Pending Verification'}</Text>
              </View>
            </View>
          </View>

          {/* ── Stats grid ───────────────────────────────────────── */}
          <View style={[bp.statsGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <BankStatBox value={inventoryUnits} label="Units in Stock" color={Colors.light.primary} icon="water" />
            <View style={[bp.statDivV, { backgroundColor: colors.border }]} />
            <BankStatBox value={bloodGroupsAvailable} label="Blood Groups" color="#8E44AD" icon="flask" />
            <View style={[bp.statDivV, { backgroundColor: colors.border }]} />
            <BankStatBox value={pendingCount} label="Pending" color="#E67E22" icon="hourglass" />
            <View style={[bp.statDivV, { backgroundColor: colors.border }]} />
            <BankStatBox value={fulfilledCount} label="Fulfilled" color="#27AE60" icon="checkmark-circle" />
          </View>

          {/* ── Bank details card ────────────────────────────────── */}
          {bank && (
            <View style={[bp.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[bp.sectionTitle, { color: colors.text }]}>Bank Details</Text>
              {contactPhone ? (
                <DetailRow icon="call-outline" value={contactPhone} colors={colors} />
              ) : null}
              {bank.email ? (
                <DetailRow icon="mail-outline" value={bank.email} colors={colors} />
              ) : null}
              {bank.location ? (
                <DetailRow
                  icon="location-outline"
                  value={[bank.location.address, bank.location.city, bank.location.state].filter(Boolean).join(', ')}
                  colors={colors}
                  multiline
                />
              ) : null}
              {bank.licenseNumber ? (
                <DetailRow icon="document-text-outline" value={`License: ${bank.licenseNumber}`} colors={colors} muted />
              ) : null}
              <View style={[bp.vStatusRow, { borderTopColor: colors.border }]}>
                <Ionicons
                  name={isVerified ? 'shield-checkmark-outline' : 'time-outline'}
                  size={15} color={isVerified ? '#27AE60' : '#E67E22'} style={{ marginRight: 8 }}
                />
                <Text style={[bp.vStatusText, { color: isVerified ? '#27AE60' : '#E67E22' }]}>
                  {isVerified ? 'Bank is verified' : vStatus === 'REJECTED' ? 'Verification rejected' : 'Verification pending review'}
                </Text>
              </View>
            </View>
          )}

          {/* ── Quick actions ────────────────────────────────────── */}
          <Text style={[bp.quickTitle, { color: colors.muted }]}>QUICK ACTIONS</Text>
          <View style={[bp.actionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActionRow
              icon="flask-outline" iconColor={Colors.light.primary} iconBg="#FDEDEC"
              label="Manage Inventory"
              sub={inventoryUnits > 0 ? `${inventoryUnits} units` : 'Add stock'}
              colors={colors}
              onPress={() => navTo(bankId ? `/blood-bank/inventory?bankId=${bankId}` : '/blood-bank/my-bank')}
            />
            <RowDivider colors={colors} />
            <ActionRow
              icon="document-text-outline" iconColor="#2980B9" iconBg="#EBF5FB"
              label="Request Center"
              sub={pendingCount > 0 ? `${pendingCount} pending` : 'No open requests'}
              colors={colors}
              onPress={() => navTo(bankId ? `/blood-bank/bank-manage?bankId=${bankId}` : '/blood-bank/my-bank')}
            />
            <RowDivider colors={colors} />
            <ActionRow
              icon="git-branch-outline" iconColor="#8E44AD" iconBg="#F5EEF8"
              label="Manage Linked Banks"
              sub="Add or link blood banks"
              colors={colors}
              onPress={() => navTo('/blood-bank/my-bank')}
            />
            <RowDivider colors={colors} />
            <ActionRow
              icon="create-outline" iconColor="#F39C12" iconBg="#FEF9E7"
              label="Edit Bank Details"
              sub="Update name, address, contact"
              colors={colors}
              onPress={() => navTo(bankId ? `/blood-bank/bank-manage?bankId=${bankId}` : '/blood-bank/my-bank')}
            />
            <RowDivider colors={colors} />
            <ActionRow
              icon="bar-chart-outline" iconColor="#1A5276" iconBg="#EBF5FB"
              label="Activity Log"
              sub="View recent events"
              colors={colors}
              onPress={() => navTo(bankId ? `/blood-bank/activity?bankId=${bankId}` : '/blood-bank/my-bank')}
              last
            />
          </View>

          {/* ── Sign out ─────────────────────────────────────────── */}
          <TouchableOpacity
            style={[bp.signOutBtn, { borderColor: '#E74C3C', backgroundColor: isDark ? '#2A1010' : '#FFF5F5' }]}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={18} color="#E74C3C" style={{ marginRight: 8 }} />
            <Text style={bp.signOutText}>Sign Out</Text>
          </TouchableOpacity>

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Bank Profile sub-components ──────────────────────────────────────────────

function BankStatBox({ value, label, color, icon }: { value: number; label: string; color: string; icon: string }) {
  const { colors } = useTheme();
  return (
    <View style={bp.statBox}>
      <Ionicons name={icon as any} size={16} color={color} style={{ marginBottom: 4 }} />
      <Text style={[bp.statNum, { color }]}>{value}</Text>
      <Text style={[bp.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, value, colors, multiline, muted }: { icon: string; value: string; colors: any; multiline?: boolean; muted?: boolean }) {
  return (
    <View style={bp.detailRow}>
      <Ionicons name={icon as any} size={16} color={Colors.light.primary} style={{ marginRight: 12, marginTop: 1 }} />
      <Text style={[bp.detailText, { color: muted ? colors.muted : colors.text }]} numberOfLines={multiline ? 2 : 1}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, iconColor, iconBg, label, sub, colors, onPress, last }: {
  icon: string; iconColor: string; iconBg: string;
  label: string; sub: string; colors: any; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity style={bp.actionRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[bp.actionIconBox, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as any} size={20} color={iconColor} />
      </View>
      <View style={bp.actionTextCol}>
        <Text style={[bp.actionLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[bp.actionSub, { color: colors.muted }]}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

function RowDivider({ colors }: { colors: any }) {
  return <View style={[bp.rowDivider, { backgroundColor: colors.border }]} />;
}

// ─── Bank-profile styles ──────────────────────────────────────────────────────

const bp = StyleSheet.create({
  heroCard: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 16,
    borderRadius: 20, overflow: 'hidden',
    elevation: 4, shadowColor: Colors.light.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10,
  },
  heroBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.light.primary,
    opacity: 0.92,
  },
  heroContent: { padding: 24, alignItems: 'center' },
  iconRing: {
    width: 76, height: 76, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
  },
  heroEmoji:    { fontSize: 38, textAlign: 'center' },
  heroName:     { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#fff', textAlign: 'center', lineHeight: 26 },
  heroLocation: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4, marginBottom: 10 },
  verifiedChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginTop: 4 },
  verifiedText: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#fff' },

  statsGrid: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, borderRadius: 16,
    borderWidth: 1, paddingVertical: 16,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  statBox:    { flex: 1, alignItems: 'center' },
  statDivV:   { width: 1, marginVertical: 6 },
  statNum:    { fontFamily: 'Poppins_700Bold', fontSize: 20 },
  statLabel:  { fontFamily: 'Poppins_400Regular', fontSize: 10, marginTop: 1, textAlign: 'center' },

  detailCard: {
    marginHorizontal: 16, marginBottom: 14, borderRadius: 16, borderWidth: 1, padding: 18, gap: 12,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, marginBottom: 2 },
  detailRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  detailText:   { fontFamily: 'Poppins_400Regular', fontSize: 13, flex: 1, lineHeight: 18 },
  vStatusRow:   { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  vStatusText:  { fontFamily: 'Poppins_500Medium', fontSize: 13 },

  quickTitle: {
    fontFamily: 'Poppins_600SemiBold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase',
    marginHorizontal: 20, marginBottom: 8, marginTop: 6,
  },
  actionsCard: {
    marginHorizontal: 16, marginBottom: 14, borderRadius: 16, borderWidth: 1, overflow: 'hidden',
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  actionRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  actionIconBox: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  actionTextCol: { flex: 1 },
  actionLabel:   { fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  actionSub:     { fontFamily: 'Poppins_400Regular', fontSize: 12, marginTop: 1 },
  rowDivider:    { height: 1, marginLeft: 70 },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5,
  },
  signOutText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#E74C3C' },
});

// ─── Donor / Recipient Profile Screen ────────────────────────────────────────
export default function ProfileScreen() {
  const { user, logout, updateUser, setUser } = useAuthStore();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatusResponse | null>(null);
  const [donorStatusData, setDonorStatusData] = useState<DonorStatusData | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      authService.getProfile().then(res => {
        if (res.success && res.data) setUser(res.data);
      }).catch(() => {});

      verificationService.getStatus().then(res => {
        if (res.success) setVerificationStatus(res.data);
      }).catch(() => {});

      donorStatusService.getStatus().then(res => {
        if (res.success && res.data) setDonorStatusData(res.data);
      }).catch(() => {});
    }, [])
  );

  // BLOOD_BANK users see a dedicated bank profile — not the donor/recipient profile
  if (user?.role === 'BLOOD_BANK') {
    return <BankProfileView />;
  }

  const handlePickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const selectedUri = result.assets[0].uri;
      
      updateUser({ avatar: selectedUri });
      
      try {
        const storedUser = await userStorage.get();
        if (storedUser) {
          await userStorage.set({ ...storedUser, avatar: selectedUri });
        }
      } catch (err) {
        console.error('Failed to save avatar', err);
      }
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() }
    ]);
  };

  // Derive stats — use Math.max across all sources so Force Active never resets the count
  const phase5Loaded = donorStatusData !== null;
  const totalDonations = Math.max(
    donorStatusData?.totalDonations ?? 0,
    user?.donorProfile?.totalDonations ?? 0,
    Math.floor((user?.livesSaved ?? 0) / 3),
  );
  const livesSaved = totalDonations * 3;
  console.log('[LivesSavedSource] phase5Loaded:', phase5Loaded);
  console.log('[LivesSavedSource] phase5TotalDonations:', donorStatusData?.totalDonations ?? 'N/A');
  console.log('[LivesSavedSource] authTotalDonations:', user?.donorProfile?.totalDonations ?? 0);
  console.log('[LivesSavedSource] selectedTotalDonations:', totalDonations);
  console.log('[LivesSaved] livesSaved:', livesSaved);
  const requestsResponded = 0;
  const heroLevel = totalDonations > 10 ? 4 : totalDonations > 5 ? 3 : totalDonations > 0 ? 2 : 1;

  const isVerified =
    user?.isDonorEligible === true ||
    user?.donorProfile?.verificationStatus === 'eligible';

  // Last donation: use donorStatusData.lastDonationDate (authoritative — comes from /donor/status
  // which reads directly from the User table updated by markFulfilled). donationHistory[0] is a
  // secondary fallback for users whose status hasn't loaded yet.
  function formatDate(isoString: string): string {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Invalid date';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  }

  function formatDonationDate(isoString: string | null | undefined): string | null {
    if (!isoString) return null;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  const statusLastDonation = donorStatusData?.lastDonationDate ?? null;
  const historyLastDonation = user?.donationHistory?.[0]?.date ?? null;

  console.log('[ProfileDonation] status.lastDonationDate:', statusLastDonation ?? 'null');
  console.log('[ProfileDonation] history.latestDate:', historyLastDonation ?? 'null');

  const selectedLastDonation = statusLastDonation ?? historyLastDonation ?? null;
  console.log('[ProfileDonation] selectedLastDonationDate:', selectedLastDonation ?? 'null');

  const formattedLastDonation = formatDonationDate(selectedLastDonation);
  console.log('[ProfileDonation] formatted:', formattedLastDonation ?? 'No donations yet');

  const hasNeverDonated = !selectedLastDonation;
  const lastDonationText = formattedLastDonation ?? 'No donations yet';

  // Bug 2 fix: Phase5 is authoritative for recovery display.
  // If Phase5 says ACTIVE+eligible (including DevQA Force Active), recovery must show 100%.
  // Auth `donationEligibility.canDonate` may still be false after Force Active — Phase5 overrides it.
  const isPhase5ActiveAndEligible =
    donorStatusData?.donorStatus === 'ACTIVE' && donorStatusData?.isEligible === true;
  const eligibility = user?.donationEligibility;
  const daysRemaining = eligibility?.daysRemaining ?? 0;
  // Phase5 ACTIVE+eligible overrides auth canDonate (handles Force Active scenario)
  const canDonate = isPhase5ActiveAndEligible ? true : (eligibility ? eligibility.canDonate : true);

  let progress: number;
  let circleText: string;
  let circleSub: string;
  let eligibilityLabel: string;
  let eligibilityValue: string;
  let circleColor: string;

  if (isPhase5ActiveAndEligible) {
    // Phase5 says active & eligible — always 100% regardless of auth/donation history
    progress = 100;
    circleText = 'Ready';
    circleSub = 'to Donate';
    eligibilityLabel = 'Status';
    eligibilityValue = 'Ready to Donate';
    circleColor = '#2ECC71';
  } else if (hasNeverDonated || canDonate) {
    // Never donated or eligible (auth-only path)
    progress = hasNeverDonated ? 0 : 100;
    circleText = 'Ready';
    circleSub = 'to Donate';
    eligibilityLabel = 'Status';
    eligibilityValue = 'Ready to Donate';
    circleColor = '#2ECC71';
  } else {
    // Deferred — show recovery progress toward 90-day mark
    progress = Math.min(Math.floor(((90 - daysRemaining) / 90) * 100), 99);
    circleText = `${progress}%`;
    circleSub = 'Recovery';
    eligibilityLabel = 'Eligible in';
    eligibilityValue = `${daysRemaining} days`;
    circleColor = '#E67E22';
  }

  console.log('[RecoveryDisplay] donorStatus:', donorStatusData?.donorStatus ?? 'null');
  console.log('[RecoveryDisplay] isEligible:', donorStatusData?.isEligible ?? false);
  console.log('[RecoveryDisplay] recoveryPercent:', progress);
  console.log('[RecoveryDisplay] lastDonationDate preserved:', selectedLastDonation ?? 'none');

  // ─── Part 4: Primary badge config ───────────────────────────────────────────
  const roleLabel = getUserDisplayRole(user);
  const roleColor = getUserRoleColor(user);
  const isDocVerified = verificationStatus?.overallStatus === 'FULLY_VERIFIED';

  type BadgeCfg = { label: string; bg: string; border: string; iconColor: string; textColor: string; icon: string };
  function primaryBadgeFor(ds: DonorStatus | undefined): BadgeCfg | null {
    if (ds === 'ACTIVE' && isDocVerified)
      return { label: 'Verified Donor', bg: '#E8F8EF', border: '#52BE80', textColor: '#1A7A3C', iconColor: '#2ECC71', icon: 'shield-checkmark' };
    if (ds === 'ACTIVE')
      return { label: 'Active Donor', bg: '#EBF5FB', border: '#5DADE2', textColor: '#1A5276', iconColor: '#2980B9', icon: 'heart' };
    if (ds === 'DEFERRED')
      return { label: 'Donor (Deferred)', bg: '#FEF5E7', border: '#F39C12', textColor: '#784212', iconColor: '#E67E22', icon: 'timer-outline' };
    if (ds === 'PENDING_REVIEW')
      return { label: 'Donor (Pending)', bg: '#FEFCE8', border: '#F1C40F', textColor: '#7D6608', iconColor: '#D4AC0D', icon: 'time' };
    if (ds === 'INELIGIBLE')
      return { label: 'Not Eligible', bg: '#FDEDEC', border: '#E74C3C', textColor: '#922B21', iconColor: '#E74C3C', icon: 'close-circle-outline' };
    if (!!user?.recipientProfile)
      return { label: 'Recipient', bg: '#EBF5FB', border: '#2980B9', textColor: '#1A5276', iconColor: '#2980B9', icon: 'person' };
    return null;
  }
  const primaryBadge = primaryBadgeFor(donorStatusData?.donorStatus ?? (isVerified ? 'ACTIVE' : undefined));
  const showEligDot = (donorStatusData?.donorStatus === 'ACTIVE' || isVerified) && canDonate;

  // ─── Part 1.3: Deferral reminder handler ─────────────────────────────────────
  const handleSetReminder = async () => {
    setReminderLoading(true);
    try {
      await donorStatusService.setReminder();
      setDonorStatusData(prev => prev ? { ...prev, reminderSet: true } : prev);
      const nextDate = donorStatusData?.nextEligibleDate;
      Alert.alert(
        'Reminder Set ✓',
        nextDate
          ? `We'll notify you when you're eligible to donate again on ${formatDate(nextDate)}.`
          : "We'll notify you when you're eligible again."
      );
    } catch {
      Alert.alert('Error', 'Could not set reminder. Please try again.');
    } finally {
      setReminderLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
        <TouchableOpacity onPress={() => router.push('/profile/settings')} style={styles.settingsBtn}>
          <Ionicons name="settings-outline" size={24} color={colors.icon} />
        </TouchableOpacity>
      </View>
      
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* User Info Section */}
        <View style={[styles.userInfoSection, { backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.avatarContainer} onPress={handlePickImage} activeOpacity={0.8}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.emojiAvatar]}>
                <Text style={styles.emojiText}>
                  {user?.profileEmoji ?? (user?.role === 'BLOOD_BANK' ? '🏥' : user?.gender === 'male' ? '👨' : user?.gender === 'female' ? '👩' : '🧑')}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          
          {/* Part 4: Clean 2-row header */}
          <View style={styles.userDetails}>
            {/* Name — no inline badges */}
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{user?.name || 'User Name'}</Text>

            {/* Top row: single primary status badge */}
            {primaryBadge && (
              <View style={styles.primaryBadgeRow}>
                <View style={[styles.primaryBadge, { backgroundColor: primaryBadge.bg, borderColor: primaryBadge.border }]}>
                  <Ionicons name={primaryBadge.icon as any} size={13} color={primaryBadge.iconColor} />
                  <Text style={[styles.primaryBadgeText, { color: primaryBadge.textColor }]} numberOfLines={1}>
                    {primaryBadge.label}
                  </Text>
                  {showEligDot && <View style={styles.eligDot} />}
                </View>
              </View>
            )}

            {/* Bottom row: role pill | blood group pill (equal width) */}
            <View style={styles.secondaryRow}>
              <View style={[styles.secondaryPill, { backgroundColor: roleColor + '18', borderColor: roleColor + '44' }]}>
                <Text style={[styles.secondaryPillText, { color: roleColor }]}>{roleLabel}</Text>
              </View>
              <View style={[styles.secondaryPill, styles.bloodPill]}>
                <Ionicons name="water" size={11} color={Colors.light.primary} />
                <Text style={[styles.secondaryPillText, { color: Colors.light.primary }]} numberOfLines={1}>
                  {user?.bloodGroup ?? 'Not Set'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats Section */}
        <View style={[styles.statsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Ionicons name="heart-outline" size={24} color="#E74C3C" />
            <Text style={[styles.statValue, { color: colors.text }]}>{livesSaved}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Lives Saved</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Ionicons name="water-outline" size={24} color="#E74C3C" />
            <Text style={[styles.statValue, { color: colors.text }]}>{totalDonations}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Total Donations</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <MaterialCommunityIcons name="account-group-outline" size={24} color={colors.icon} />
            <Text style={[styles.statValue, { color: colors.text }]}>{requestsResponded}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Requests Responded</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <MaterialCommunityIcons name="medal-outline" size={24} color="#E67E22" />
            <Text style={[styles.statValue, { color: colors.text }]}>{heroLevel}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Blood Hero Level</Text>
          </View>
        </View>

        {/* Verification Status Summary */}
        <TouchableOpacity
          style={[styles.verificationCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/profile/verification-status')}
          activeOpacity={0.85}
        >
          <View style={styles.verificationCardHeader}>
            <Text style={[styles.verificationCardTitle, { color: colors.text }]}>Verification Status</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </View>
          <View style={styles.verificationBadgeRow}>
            {[
              { label: 'ID Proof', key: 'idVerified' as const },
              { label: 'Blood Group', key: 'bloodGroupVerified' as const },
              { label: 'Medical', key: 'medicalVerified' as const },
            ].map(({ label, key }) => {
              const verified = verificationStatus
                ? verificationStatus[key as keyof VerificationStatusResponse] as boolean
                : (user?.[key] ?? false);
              return (
                <View key={key} style={[styles.vBadge, verified ? styles.vBadgeVerified : styles.vBadgePending]}>
                  <Ionicons
                    name={verified ? 'checkmark-circle' : 'ellipse-outline'}
                    size={12}
                    color={verified ? '#2ECC71' : '#BDC3C7'}
                  />
                  <Text style={[styles.vBadgeText, { color: verified ? '#1A8A48' : '#999' }]}>{label}</Text>
                </View>
              );
            })}
          </View>
          {verificationStatus && (
            <Text style={[
              styles.verificationOverall,
              verificationStatus.overallStatus === 'FULLY_VERIFIED' && { color: '#2ECC71' },
              verificationStatus.overallStatus === 'PARTIALLY_VERIFIED' && { color: '#F39C12' },
              verificationStatus.overallStatus === 'UNVERIFIED' && { color: '#95A5A6' },
            ]}>
              {verificationStatus.overallStatus === 'FULLY_VERIFIED' ? 'Fully Verified'
                : verificationStatus.overallStatus === 'PARTIALLY_VERIFIED' ? 'Verification In Progress'
                  : 'Verification Required — tap to upload documents'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Donation Status Card */}
        <View style={[styles.donationStatusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.dsHeader}>
            <View style={styles.dsLabelContainer}>
              <Text style={[styles.dsLabel, { color: colors.muted }]}>Donation Status</Text>
            </View>
            <Text style={[styles.dsTitle, { color: colors.text }]}>You're a Life Saver! ❤️</Text>
          </View>

          <View style={styles.dsBody}>
            <View style={styles.dsBlock}>
              <Text style={[styles.dsBlockTitle, { color: colors.muted }]}>Last Donation</Text>
              <Text style={[styles.dsBlockValue, { color: colors.text }, hasNeverDonated && { color: colors.muted, fontFamily: 'Poppins_500Medium' }]}>
                {lastDonationText}
              </Text>
            </View>

            <View style={styles.dsCircle}>
              <View style={[styles.circleOuter, { borderTopColor: circleColor, borderRightColor: circleColor }]}>
                <View style={[styles.circleInner, { backgroundColor: colors.card }]}>
                  <Text style={[styles.circlePercent, { color: circleColor }]}>{circleText}</Text>
                  <Text style={[styles.circleLabel, { color: colors.muted }]}>{circleSub}</Text>
                </View>
              </View>
            </View>

            <View style={styles.dsBlock}>
              <Text style={[styles.dsBlockTitle, { color: colors.muted }]}>{eligibilityLabel}</Text>
              <Text style={[styles.dsBlockValue, { color: circleColor }]}>{eligibilityValue}</Text>
            </View>
          </View>

          <View style={[styles.progressBarContainer, { backgroundColor: colors.surface }]}>
            <View style={[styles.progressBarFill, { width: `${progress}%`, backgroundColor: circleColor }]} />
          </View>

          {isVerified && !donorStatusData?.deferralDate && (
            <View style={styles.donorEligibilityRow}>
              <Ionicons name="checkmark-circle" size={16} color="#2ECC71" />
              <Text style={[styles.donorEligibilityText, { color: colors.text }]}>Eligible Blood Donor</Text>
              {user?.donorEligibilityExpiry && (
                <Text style={[styles.donorEligibilityExpiry, { color: colors.muted }]}>
                  {' '}· valid until {formatDate(user.donorEligibilityExpiry)}
                </Text>
              )}
            </View>
          )}

          {/* Part 1.3: Deferral section */}
          {donorStatusData?.donorStatus === 'DEFERRED' && (
            <View style={styles.deferralSection}>
              <View style={styles.deferralHeader}>
                <Ionicons name="timer-outline" size={18} color="#E67E22" />
                <Text style={styles.deferralTitle}>Temporarily Deferred</Text>
              </View>
              {donorStatusData.nextEligibleDate && (
                <Text style={styles.deferralDate}>
                  Eligible again on {formatDate(donorStatusData.nextEligibleDate)}
                  {donorStatusData.daysRemaining != null && (
                    <Text style={styles.deferralDays}> · {donorStatusData.daysRemaining} day{donorStatusData.daysRemaining === 1 ? '' : 's'} remaining</Text>
                  )}
                </Text>
              )}
              {donorStatusData.deferralReason && (
                <Text style={styles.deferralReason}>{donorStatusData.deferralReason}</Text>
              )}
              <TouchableOpacity
                style={[styles.reminderBtn, donorStatusData.reminderSet && styles.reminderBtnSet, reminderLoading && { opacity: 0.7 }]}
                onPress={donorStatusData.reminderSet ? undefined : handleSetReminder}
                disabled={reminderLoading || donorStatusData.reminderSet}
                activeOpacity={donorStatusData.reminderSet ? 1 : 0.7}
              >
                {reminderLoading
                  ? <ActivityIndicator size="small" color="#E67E22" />
                  : <Ionicons name={donorStatusData.reminderSet ? 'notifications' : 'notifications-outline'} size={16} color={donorStatusData.reminderSet ? '#27AE60' : '#E67E22'} />
                }
                <Text style={[styles.reminderBtnText, donorStatusData.reminderSet && { color: '#27AE60' }]}>
                  {donorStatusData.reminderSet ? 'Reminder Set ✓' : 'Set Reminder'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Part 1.3: Ineligible section */}
          {donorStatusData?.donorStatus === 'INELIGIBLE' && (
            <View style={[styles.deferralSection, { borderColor: '#FDEDEC', backgroundColor: '#FFF5F5' }]}>
              <View style={styles.deferralHeader}>
                <Ionicons name="close-circle-outline" size={18} color="#E74C3C" />
                <Text style={[styles.deferralTitle, { color: '#E74C3C' }]}>Not Eligible to Donate</Text>
              </View>
              {donorStatusData.deferralReason && (
                <Text style={styles.deferralReason}>{donorStatusData.deferralReason}</Text>
              )}
              <Text style={styles.deferralDate}>Please consult a doctor for more information.</Text>
            </View>
          )}
        </View>

        {/* Menu List */}
        <View style={[styles.menuContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/profile/personal-details')}>
            <Ionicons name="clipboard-outline" size={22} color={colors.icon} style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: colors.text }]}>Personal Details</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/profile/donation-history')}>
            <Ionicons name="calendar-outline" size={22} color={colors.icon} style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: colors.text }]}>Donation History</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/profile/edit-profile')}>
            <Ionicons name="create-outline" size={22} color={colors.icon} style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: colors.text }]}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>

          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={22} color="#E74C3C" style={styles.menuIcon} />
            <Text style={[styles.menuText, { color: '#E74C3C' }]}>Log Out</Text>
          </TouchableOpacity>

        </View>
        
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#111',
  },
  settingsBtn: {
    padding: 5,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  userInfoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 25,
  },
  avatarContainer: {
    marginRight: 20,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#EAEAEA',
  },
  emojiAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiText: {
    fontSize: 40,
  },
  userDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: '#222',
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 6,
  },
  verifiedText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#2ECC71',
    marginLeft: 4,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  roleBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },
  bloodGroupBadge: {
    backgroundColor: '#FDEDEC',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  bloodGroupBadgeText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#333',
  },
  bloodGroupBold: {
    fontFamily: 'Poppins_700Bold',
    color: '#E74C3C',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 10,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#222',
    marginTop: 6,
  },
  statLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: '60%',
    backgroundColor: '#F0F0F0',
    alignSelf: 'center',
  },
  verificationCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  verificationCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  verificationCardTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#222',
  },
  verificationBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  vBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  vBadgeVerified: {
    backgroundColor: '#E8F8EF',
  },
  vBadgePending: {
    backgroundColor: '#F2F3F4',
  },
  vBadgeText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
  },
  verificationOverall: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    marginTop: 4,
  },
  donationStatusCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  dsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  dsLabelContainer: {
    backgroundColor: '#F5F6FA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dsLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#333',
  },
  dsTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#E74C3C',
  },
  dsBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  dsBlock: {
    alignItems: 'center',
    flex: 1,
  },
  dsBlockTitle: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  dsBlockValue: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    color: '#222',
  },
  dsCircle: {
    flex: 1,
    alignItems: 'center',
  },
  circleOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#F0F0F0',
    borderTopColor: '#E74C3C',
    borderRightColor: '#E74C3C',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-45deg' }],
  },
  circleInner: {
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
  },
  circlePercent: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: '#222',
  },
  circleLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 10,
    color: '#666',
  },
  progressBarContainer: {
    height: 6,
    backgroundColor: '#F0F0F0',
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2ECC71',
  },
  donorEligibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    flexWrap: 'wrap',
  },
  donorEligibilityText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#2ECC71',
    marginLeft: 5,
  },
  donorEligibilityExpiry: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
  },
  menuContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuIcon: {
    marginRight: 15,
  },
  menuText: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: '#333',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F5F5F5',
    marginLeft: 55,
  },

  // ─── Part 4: New header styles ────────────────────────────────────────────
  primaryBadgeRow: {
    marginTop: 6,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  primaryBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
  },
  eligDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2ECC71',
    marginLeft: 2,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  secondaryPill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  bloodPill: {
    backgroundColor: '#FDEDEC',
    borderColor: Colors.light.primary + '44',
  },
  secondaryPillText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },

  // ─── Part 1.3: Deferral section styles ───────────────────────────────────
  deferralSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FEF5E7',
    backgroundColor: '#FFFBF5',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F39C1222',
  },
  deferralHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  deferralTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#E67E22',
  },
  deferralDate: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#555',
    marginBottom: 4,
  },
  deferralDays: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
  },
  deferralReason: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  reminderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E67E22',
    backgroundColor: '#FFF',
    marginTop: 4,
  },
  reminderBtnSet: {
    borderColor: '#27AE60',
    backgroundColor: '#EAFAF1',
  },
  reminderBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#E67E22',
  },
});
