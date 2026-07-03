import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { donorStatusService } from '../../services/donorStatusService';
import { DonorStatusData } from '../../types';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#2ECC71',
  PENDING_REVIEW: '#F39C12',
  DEFERRED: '#E67E22',
  INELIGIBLE: '#E74C3C',
  NEVER_DONATED: '#95A5A6',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active Donor',
  PENDING_REVIEW: 'Pending Review',
  DEFERRED: 'Deferred',
  INELIGIBLE: 'Ineligible',
  NEVER_DONATED: 'Not Yet Donated',
};

export default function DonorCardScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  console.log('[Theme] applied screen: donor-card');
  const user = useAuthStore(state => state.user);
  const [donorData, setDonorData] = useState<DonorStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    donorStatusService.getStatus()
      .then(res => {
        if (res.success && res.data) {
          setDonorData(res.data);
          const livesSaved = (res.data.totalDonations ?? 0) * 3;
          console.log('[DonorCard] loaded: totalDonations=', res.data.totalDonations, '| livesSaved=', livesSaved, '| status=', res.data.donorStatus);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalDonations = donorData?.totalDonations ?? user?.donorProfile?.totalDonations ?? 0;
  const livesSaved = totalDonations * 3;
  const donorStatus = donorData?.donorStatus ?? 'NEVER_DONATED';
  const statusColor = STATUS_COLOR[donorStatus] ?? '#95A5A6';
  const statusLabel = STATUS_LABEL[donorStatus] ?? donorStatus;
  const defaultEmoji = user?.role === 'BLOOD_BANK' ? '🏥' : '🧑';
  const displayEmoji = user?.profileEmoji ?? defaultEmoji;

  // Short QR placeholder — first 8 chars of userId
  const shortId = (user?.id ?? '????????').slice(0, 8).toUpperCase();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Donor Card</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Card */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            {/* Header strip — always brand red, intentionally not themed */}
            <View style={styles.cardHeader}>
              <View style={styles.logoRow}>
                <Ionicons name="water" size={22} color="#fff" />
                <Text style={styles.cardLogoText}>BloodLink</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + '30', borderColor: statusColor }]}>
                <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>

            {/* Avatar + Name */}
            <View style={styles.avatarRow}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.surface }]}>
                <Text style={styles.avatarEmoji}>{displayEmoji}</Text>
              </View>
              <View style={styles.nameBlock}>
                <Text style={[styles.donorName, { color: colors.text }]}>{user?.name ?? '—'}</Text>
                <Text style={[styles.donorPhone, { color: colors.muted }]}>{user?.phone ?? '—'}</Text>
              </View>
            </View>

            {/* Divider */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.text }]}>{user?.bloodGroup ?? '—'}</Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Blood Group</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.text }]}>{totalDonations}</Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Donations</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: Colors.light.primary }]}>{livesSaved}</Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Lives Saved</Text>
              </View>
            </View>

            {/* Next eligible */}
            <View style={styles.eligRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.icon} />
              <Text style={[styles.eligText, { color: colors.muted }]}>
                Next eligible: {donorStatus === 'ACTIVE' ? 'Now' : formatDate(donorData?.nextEligibleDate)}
              </Text>
            </View>

            {/* QR placeholder */}
            <View style={[styles.qrBlock, { borderTopColor: colors.border }]}>
              <View style={[styles.qrPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.qrCode, { color: colors.text }]}>{shortId}</Text>
                <Text style={[styles.qrHint, { color: colors.muted }]}>Donor ID</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.note, { color: colors.muted }]}>Present this card at any BloodLink partner hospital or blood bank.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn: { padding: 5 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#333' },
  content: { padding: 24, paddingBottom: 60, alignItems: 'center' },
  card: {
    width: '100%', backgroundColor: '#fff', borderRadius: 24,
    overflow: 'hidden', elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 10,
  },
  cardHeader: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLogoText: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#fff' },
  statusBadge: {
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  statusLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 12 },
  avatarRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 14,
  },
  avatarCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: Colors.light.primary + '40',
  },
  avatarEmoji: { fontSize: 36 },
  nameBlock: { flex: 1 },
  donorName: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#111' },
  donorPhone: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#888', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginHorizontal: 20 },
  statsGrid: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 20,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#111' },
  statLabel: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginTop: 2 },
  eligRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingBottom: 16,
  },
  eligText: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#666' },
  qrBlock: {
    alignItems: 'center', paddingBottom: 24, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  qrPlaceholder: {
    width: 120, height: 120, borderRadius: 12,
    backgroundColor: '#F5F5F5', borderWidth: 2, borderColor: '#E0E0E0', borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  qrCode: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#333', letterSpacing: 2 },
  qrHint: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#aaa', marginTop: 4 },
  note: {
    fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#aaa',
    textAlign: 'center', marginTop: 20, paddingHorizontal: 20,
  },
});
