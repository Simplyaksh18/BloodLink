import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, StyleSheet, Alert, StatusBar, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { adminService } from '../../services/bloodService';

const SOURCE_TAG = 'API_DB_ONLY';
const ADMIN_BANKS_ENDPOINT = '/v1/admin/blood-banks';

type BankRow = {
  id: string;
  name: string;
  city: string;
  state: string;
  contactPhone: string;
  email: string | null;
  licenseNumber: string | null;
  verificationStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  createdAt: string;
};

const TABS: Array<{ key: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED'; label: string }> = [
  { key: 'PENDING_REVIEW', label: 'Pending' },
  { key: 'VERIFIED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function AdminDashboard() {
  const { colors, isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const [tab, setTab] = useState<'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED'>('PENDING_REVIEW');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [stats, setStats] = useState({ PENDING_REVIEW: 0, VERIFIED: 0, REJECTED: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: typeof tab) => {
    setError(null);
    try {
      const res = await adminService.listBloodBanks(status);
      if (res.success && res.data) {
        const rows = res.data.banks as BankRow[];
        const st = res.data.stats as { PENDING_REVIEW: number; VERIFIED: number; REJECTED: number };
        setBanks(rows);
        setStats(st);
        setTotal((st.PENDING_REVIEW ?? 0) + (st.VERIFIED ?? 0) + (st.REJECTED ?? 0));
        console.log(`[AdminVerification] endpoint: ${ADMIN_BANKS_ENDPOINT}?status=${status}`);
        console.log(`[AdminVerification] source: ${SOURCE_TAG}`);
        console.log(`[AdminVerification] fallbackUsed: false`);
        console.log(`[AdminVerification] firstNames:`, rows.slice(0, 5).map((b) => b.name));
        console.log(`[AdminVerification] pending count: ${st.PENDING_REVIEW ?? 0}`);
        console.log(`[AdminVerification] approved count: ${st.VERIFIED ?? 0}`);
        console.log(`[AdminVerification] rejected count: ${st.REJECTED ?? 0}`);
      } else {
        setError(res.message ?? 'Failed to load banks');
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load banks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const onRefresh = () => { setRefreshing(true); load(tab); };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[s.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      {/* Header */}
      <View style={[s.header, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <View style={s.headerText}>
          <Text style={[s.h1, { color: colors.text }]} numberOfLines={1}>Blood Bank Verification</Text>
          <Text style={[s.h2, { color: colors.muted }]} numberOfLines={1}>Review and approve registered blood banks</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={toggleTheme} style={s.iconBtn} accessibilityLabel="Toggle theme" hitSlop={8}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={s.iconBtn} accessibilityLabel="Sign out" hitSlop={8}>
            <Ionicons name="log-out-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[s.scroll, { paddingBottom: 24 + Math.max(insets.bottom, 12) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.light.primary} />}
      >
        {/* Stat cards */}
        <View style={s.statRow}>
          <StatCard label="Pending"  value={stats.PENDING_REVIEW} color="#E67E22" bg={colors.card} border={colors.border} textColor={colors.text} muted={colors.muted} />
          <StatCard label="Approved" value={stats.VERIFIED}       color="#27AE60" bg={colors.card} border={colors.border} textColor={colors.text} muted={colors.muted} />
        </View>
        <View style={s.statRow}>
          <StatCard label="Rejected" value={stats.REJECTED}       color="#C0392B" bg={colors.card} border={colors.border} textColor={colors.text} muted={colors.muted} />
          <StatCard label="Total"    value={total}                color={Colors.light.primary} bg={colors.card} border={colors.border} textColor={colors.text} muted={colors.muted} />
        </View>

        {/* Tabs */}
        <View style={[s.tabs, { borderColor: colors.border }]}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, tab === t.key && { borderBottomColor: Colors.light.primary, borderBottomWidth: 2 }]}
              onPress={() => { setLoading(true); setTab(t.key); }}
            >
              <Text style={[s.tabText, { color: tab === t.key ? Colors.light.primary : colors.muted }]}>
                {t.label} ({stats[t.key] ?? 0})
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
        ) : error ? (
          <View style={s.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color="#C0392B" />
            <Text style={[s.emptyText, { color: colors.text }]}>{error}</Text>
            <TouchableOpacity
              style={[s.retryBtn, { borderColor: Colors.light.primary }]}
              onPress={() => { setLoading(true); load(tab); }}
            >
              <Ionicons name="refresh" size={16} color={Colors.light.primary} />
              <Text style={[s.retryText, { color: Colors.light.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : banks.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="file-tray-outline" size={40} color={colors.muted} />
            <Text style={[s.emptyText, { color: colors.muted }]}>
              {tab === 'PENDING_REVIEW' ? 'No banks awaiting review'
                : tab === 'VERIFIED' ? 'No approved banks yet'
                : 'No rejected banks'}
            </Text>
          </View>
        ) : (
          banks.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/(admin)/bank/${b.id}` as any)}
            >
              <View style={s.cardHead}>
                <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>{b.name}</Text>
                <StatusPill status={b.verificationStatus} />
              </View>
              <Row icon="location-outline" text={`${b.city}${b.state ? ', ' + b.state : ''}`} colors={colors} />
              <Row icon="call-outline" text={b.contactPhone} colors={colors} />
              {b.email ? <Row icon="mail-outline" text={b.email} colors={colors} /> : null}
              {b.licenseNumber ? <Row icon="document-text-outline" text={`License: ${b.licenseNumber}`} colors={colors} /> : null}
              <Row icon="calendar-outline" text={new Date(b.createdAt).toLocaleDateString()} colors={colors} />
              <View style={s.viewBtn}>
                <Text style={[s.viewBtnText, { color: Colors.light.primary }]}>View Details</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.light.primary} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, color, bg, border, textColor, muted }: any) {
  return (
    <View style={[s.stat, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={[s.statLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING_REVIEW: { bg: '#FDEBD0', fg: '#B9770E', label: 'Pending' },
    VERIFIED:       { bg: '#EAFAF1', fg: '#27AE60', label: 'Approved' },
    REJECTED:       { bg: '#FADBD8', fg: '#C0392B', label: 'Rejected' },
  };
  const v = map[status] ?? map.PENDING_REVIEW;
  return (
    <View style={[s.pill, { backgroundColor: v.bg }]}>
      <Text style={[s.pillText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

function Row({ icon, text, colors }: any) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={14} color={colors.icon} />
      <Text style={[s.rowText, { color: colors.muted }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 6 : 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerText: { flex: 1, minWidth: 0, paddingRight: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  h1: { fontFamily: 'Poppins_700Bold', fontSize: 20 },
  h2: { fontFamily: 'Poppins_400Regular', fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 8, marginLeft: 4 },
  scroll: { padding: 16 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14 },
  statValue: { fontFamily: 'Poppins_700Bold', fontSize: 26 },
  statLabel: { fontFamily: 'Poppins_500Medium', fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, marginTop: 6, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, flex: 1, marginRight: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rowText: { fontFamily: 'Poppins_400Regular', fontSize: 13, flex: 1 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 10, gap: 4 },
  viewBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13 },
  center: { paddingVertical: 40, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: { fontFamily: 'Poppins_500Medium', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 8 },
  retryText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13 },
});
