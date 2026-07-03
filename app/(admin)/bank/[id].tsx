import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, StyleSheet, TextInput, Modal, StatusBar, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../../constants/Colors';
import { useTheme } from '../../../context/ThemeContext';
import { adminService } from '../../../services/bloodService';

type BankDetail = {
  id: string;
  name: string;
  licenseNumber: string | null;
  contactPhone: string;
  email: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  verificationStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  isVerified: boolean;
  rejectionReason: string | null;
  createdAt: string;
  ownerId: string | null;
  owner?: { id: string; name: string; phone: string; email: string | null } | null;
};

export default function AdminBankDetails() {
  const { colors, isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const bankId = params.id;

  const [bank, setBank] = useState<BankDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await adminService.getBloodBankDetail(bankId);
      if (res.success && res.data) setBank(res.data as BankDetail);
      else Alert.alert('Error', res.message ?? 'Failed to load bank');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to load bank');
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    setActing(true);
    try {
      const res = await adminService.reviewDocument(bankId, 'approve');
      if (res.success) {
        Alert.alert('Approved', 'Blood bank verified successfully.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else Alert.alert('Error', res.message ?? 'Approval failed');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Approval failed');
    } finally { setActing(false); }
  };

  const reject = async () => {
    if (!reason.trim()) return Alert.alert('Reason required', 'Please enter a rejection reason.');
    setActing(true);
    try {
      const res = await adminService.reviewDocument(bankId, 'reject', reason.trim());
      if (res.success) {
        setRejectOpen(false);
        Alert.alert('Rejected', 'Blood bank marked as rejected.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else Alert.alert('Error', res.message ?? 'Rejection failed');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Rejection failed');
    } finally { setActing(false); }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[s.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
        <Header colors={colors} title="Bank Details" onBack={() => router.back()} isDark={isDark} onToggleTheme={toggleTheme} />
        <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!bank) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[s.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
        <Header colors={colors} title="Bank Details" onBack={() => router.back()} isDark={isDark} onToggleTheme={toggleTheme} />
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
          <Text style={[s.errText, { color: colors.muted }]}>Bank not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isPending = bank.verificationStatus === 'PENDING_REVIEW';

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      <Header colors={colors} title="Bank Details" onBack={() => router.back()} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[s.scroll, { paddingBottom: 24 + Math.max(insets.bottom, 12) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.titleRow}>
            <Text style={[s.name, { color: colors.text }]}>{bank.name}</Text>
            <StatusPill status={bank.verificationStatus} />
          </View>

          <Section title="Basic Information" colors={colors}>
            <Field label="License Number" value={bank.licenseNumber ?? '—'} colors={colors} />
            <Field label="Address" value={`${bank.address}, ${bank.city}, ${bank.state} ${bank.pincode}`} colors={colors} />
            <Field label="Registered On" value={new Date(bank.createdAt).toLocaleString()} colors={colors} />
          </Section>

          <Section title="Contact" colors={colors}>
            <Field label="Contact Person" value={bank.owner?.name ?? '—'} colors={colors} />
            <Field label="Phone" value={bank.contactPhone} colors={colors} />
            {bank.email ? <Field label="Email" value={bank.email} colors={colors} /> : null}
            {bank.owner?.phone ? <Field label="Owner Phone" value={bank.owner.phone} colors={colors} /> : null}
            {bank.owner?.email ? <Field label="Owner Email" value={bank.owner.email} colors={colors} /> : null}
          </Section>

          <Section title="Uploaded Documents" colors={colors}>
            <View style={[s.docRow, { borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={18} color={Colors.light.primary} />
              <Text style={[s.docText, { color: colors.text }]}>License #{bank.licenseNumber ?? 'Not provided'}</Text>
            </View>
          </Section>

          {bank.rejectionReason ? (
            <Section title="Previous Rejection Reason" colors={colors}>
              <Text style={[s.rejectText, { color: '#C0392B' }]}>{bank.rejectionReason}</Text>
            </Section>
          ) : null}
        </View>

        {isPending && (
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: '#27AE60' }, acting && { opacity: 0.6 }]}
              onPress={approve}
              disabled={acting}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={s.btnText}>{acting ? 'Working…' : 'Approve'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: '#C0392B' }, acting && { opacity: 0.6 }]}
              onPress={() => setRejectOpen(true)}
              disabled={acting}
            >
              <Ionicons name="close-circle-outline" size={18} color="#fff" />
              <Text style={s.btnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Reject reason modal */}
      <Modal visible={rejectOpen} transparent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <View style={s.modalBg}>
          <View style={[s.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.modalTitle, { color: colors.text }]}>Reject blood bank</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              placeholder="Reason for rejection"
              placeholderTextColor={colors.muted}
              style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            />
            <View style={s.modalActions}>
              <TouchableOpacity onPress={() => setRejectOpen(false)} style={s.modalCancel}>
                <Text style={{ color: colors.muted, fontFamily: 'Poppins_600SemiBold' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={reject} style={[s.btn, { backgroundColor: '#C0392B', flex: 0, paddingHorizontal: 20 }]} disabled={acting}>
                <Text style={s.btnText}>{acting ? 'Rejecting…' : 'Confirm'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ colors, title, onBack, isDark, onToggleTheme }: any) {
  return (
    <View style={[s.header, { borderColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={s.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[s.headerTitle, { color: colors.text }]}>{title}</Text>
      <TouchableOpacity onPress={onToggleTheme} style={s.backBtn} accessibilityLabel="Toggle theme">
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

function Section({ title, colors, children }: any) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[s.sectionTitle, { color: colors.muted }]}>{title.toUpperCase()}</Text>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

function Field({ label, value, colors }: any) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[s.fieldValue, { color: colors.text }]}>{value}</Text>
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

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'android' ? 6 : 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 6 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16 },
  scroll: { padding: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontFamily: 'Poppins_700Bold', fontSize: 20, flex: 1, marginRight: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, letterSpacing: 0.5 },
  field: { marginTop: 8 },
  fieldLabel: { fontFamily: 'Poppins_500Medium', fontSize: 11 },
  fieldValue: { fontFamily: 'Poppins_500Medium', fontSize: 14, marginTop: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 6 },
  docText: { fontFamily: 'Poppins_500Medium', fontSize: 13 },
  rejectText: { fontFamily: 'Poppins_500Medium', fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10 },
  btnText: { fontFamily: 'Poppins_600SemiBold', color: '#fff', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errText: { fontFamily: 'Poppins_500Medium', fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modal: { borderRadius: 14, borderWidth: 1, padding: 18 },
  modalTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, marginBottom: 10 },
  input: { minHeight: 90, borderWidth: 1, borderRadius: 10, padding: 12, fontFamily: 'Poppins_400Regular', fontSize: 14, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 10 },
});
