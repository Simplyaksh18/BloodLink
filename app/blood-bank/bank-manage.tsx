import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { bloodBankService, BankRequest, InventoryItem } from '../../services/bloodService';
import { BloodBank } from '../../types';
import { timeAgo } from '../../utils/timeAgo';
import { uploadService } from '../../services/bloodService';

// ─── Priority colours ──────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#E74C3C', HIGH: '#E67E22', MEDIUM: '#F1C40F', LOW: '#2ECC71',
};

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open', ACTIVE: 'Awaiting', IN_PROGRESS: 'In Progress',
  FULFILLED: 'Fulfilled', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: '#3498DB', ACTIVE: '#9B59B6', IN_PROGRESS: '#E67E22',
  FULFILLED: '#2ECC71', CANCELLED: '#E74C3C', EXPIRED: '#95A5A6',
};

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function BankManageScreen() {
  const router = useRouter();
  const { bankId } = useLocalSearchParams<{ bankId: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  console.log('[BankTheme] screen: bank-manage');
  console.log('[BankRoute] received params: bankId=', bankId);
  console.log('[SafeAreaFix] bottom inset:', insets.bottom);

  const [bank, setBank]               = useState<BloodBank | null>(null);
  const [requests, setRequests]       = useState<BankRequest[]>([]);
  const [inventory, setInventory]     = useState<InventoryItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [fetchError, setFetchError]   = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edit-profile mode
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);

  // Proof-of-delivery modal
  const [proofModal, setProofModal]   = useState(false);
  const [proofRequestId, setProofRequestId] = useState<string | null>(null);
  const [proofNote, setProofNote]     = useState('');
  const [proofImage, setProofImage]   = useState<string | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [completing, setCompleting]   = useState(false);

  // ─── Fetch ────────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!bankId) return;
    setFetchError(false);
    try {
      const [bankRes, reqRes, invRes] = await Promise.all([
        bloodBankService.getBankById(bankId),
        bloodBankService.getMyBankRequests(bankId),
        bloodBankService.getMyInventory(bankId),
      ]);
      if (bankRes.success && bankRes.data) setBank(bankRes.data);
      if (reqRes.success && reqRes.data) {
        console.log('[BloodBankUI] requests count:', reqRes.data.length);
        setRequests(reqRes.data);
      }
      if (invRes.success && invRes.data) {
        console.log('[BloodBankUI] inventory count:', invRes.data.length);
        setInventory(invRes.data);
      }
    } catch (e) {
      console.error('[BloodBankUI] bank-manage fetch error:', e);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useFocusEffect(
    useCallback(() => {
      console.log('[BloodBankUI] bank-manage focused:', bankId);
      setLoading(true);
      refresh();
    }, [refresh])
  );

  // ─── Request actions ─────────────────────────────────────────────────────────

  const handleAccept = async (requestId: string) => {
    setActionLoading(requestId + '_accept');
    try {
      await bloodBankService.acceptBankRequest(requestId, bankId);
      console.log('[BloodBankUI] request action success: accepted', requestId);
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'IN_PROGRESS' } : r));
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Could not accept request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = (requestId: string) => {
    Alert.alert('Decline Request', 'Decline this blood request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          setActionLoading(requestId + '_reject');
          try {
            await bloodBankService.rejectBankRequest(requestId, bankId);
            console.log('[BloodBankUI] request action success: rejected', requestId);
            setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'CANCELLED' } : r));
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.message ?? 'Could not decline request.');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const openProofModal = (requestId: string) => {
    setProofRequestId(requestId);
    setProofNote('');
    setProofImage(null);
    setProofModal(true);
  };

  const pickImage = async (from: 'camera' | 'library') => {
    const fn = from === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await fn({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setProofImage(result.assets[0].uri);
    }
  };

  const handleComplete = async () => {
    if (!proofRequestId) return;
    setCompleting(true);
    try {
      let proofImageUrl: string | undefined;

      if (proofImage) {
        setUploading(true);
        try {
          const uploadRes = await uploadService.uploadDocument(proofImage, 'BLOOD_BANK_PROOF', 'image/jpeg');
          if (uploadRes.success) proofImageUrl = uploadRes.data?.url;
        } catch (e) {
          console.warn('[BloodBankUI] proof upload failed, completing without image');
        } finally {
          setUploading(false);
        }
      }

      await bloodBankService.completeBankRequest(
        proofRequestId,
        { proofNote: proofNote.trim() || undefined, proofImageUrl },
        bankId
      );
      console.log('[BloodBankUI] request action success: completed', proofRequestId);
      setRequests(prev => prev.map(r => r.id === proofRequestId ? { ...r, status: 'FULFILLED' } : r));
      setProofModal(false);
      Alert.alert('Fulfilled', 'Request marked as complete.');
    } catch (e: any) {
      Alert.alert('Cannot Complete', e?.response?.data?.message ?? 'Could not complete request.');
    } finally {
      setCompleting(false);
    }
  };

  // ─── Profile edit ─────────────────────────────────────────────────────────────

  const startEdit = () => {
    if (!bank) return;
    setEditData({
      name: bank.name,
      contactPhone: bank.contactPhone ?? '',
      email: bank.email ?? '',
      address: bank.address ?? '',
      city: bank.location.city,
      state: bank.location.state,
      pincode: bank.location.pincode ?? '',
    });
    setEditMode(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await bloodBankService.updateMyBank(
        { name: editData.name, contactPhone: editData.contactPhone, email: editData.email || undefined,
          address: editData.address, city: editData.city, state: editData.state, pincode: editData.pincode || undefined },
        bankId
      );
      if (res.success) {
        setBank(res.data ?? bank);
        setEditMode(false);
      } else {
        Alert.alert('Failed', res.message ?? 'Update failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Dev verify ───────────────────────────────────────────────────────────────

  const handleDevVerify = async () => {
    if (!bankId) return;
    try {
      await bloodBankService.devVerify(bankId);
      setBank(prev => prev ? { ...prev, verificationStatus: 'VERIFIED', isVerified: true } : prev);
      Alert.alert('Done', 'Bank marked as verified (dev).');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Dev verify failed.');
    }
  };

  // ─── Render guards ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <Header title="Manage Bank" onBack={() => router.back()} />
        <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      </SafeAreaView>
    );
  }

  if (fetchError || !bank) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <Header title="Manage Bank" onBack={() => router.back()} />
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text style={[s.errText, { color: colors.muted }]}>Could not load bank</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); refresh(); }}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const invTotal        = inventory.filter(i => i.status === 'ACTIVE').reduce((s, i) => s + i.units, 0);
  const pendingReq      = requests.filter(r => ['ACTIVE', 'OPEN'].includes(r.status)).length;
  const inProgressReq   = requests.filter(r => r.status === 'IN_PROGRESS').length;
  // Use fulfilledRequests from bank stats if available (covers historical), fallback to loaded requests
  const completedReq    = (bank as any).fulfilledRequests ?? requests.filter(r => r.status === 'FULFILLED').length;
  console.log('[BloodBankStats] inventory:', invTotal, '| pending:', pendingReq, '| inProgress:', inProgressReq, '| completed:', completedReq);

  const vStatus = bank.verificationStatus ?? (bank.isVerified ? 'VERIFIED' : 'PENDING_REVIEW');
  const VS_COLOR: Record<string, string> = { VERIFIED: '#2ECC71', PENDING_REVIEW: '#F39C12', REJECTED: '#E74C3C' };
  const VS_LABEL: Record<string, string> = { VERIFIED: 'Verified', PENDING_REVIEW: 'Pending Review', REJECTED: 'Rejected' };

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      <Header title={bank.name} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── PROFILE CARD ── */}
        <View style={[s.card, { backgroundColor: colors.card }]}>
          <View style={s.cardHeaderRow}>
            <View style={[s.vBadge, { backgroundColor: (VS_COLOR[vStatus] ?? '#F39C12') + '20', borderColor: VS_COLOR[vStatus] ?? '#F39C12' }]}>
              <Ionicons name={vStatus === 'VERIFIED' ? 'checkmark-circle' : 'time-outline'} size={13} color={VS_COLOR[vStatus] ?? '#F39C12'} />
              <Text style={[s.vBadgeText, { color: VS_COLOR[vStatus] ?? '#F39C12' }]}>{VS_LABEL[vStatus] ?? 'Pending'}</Text>
            </View>
            {!editMode && (
              <TouchableOpacity onPress={startEdit} style={s.editBtn}>
                <Ionicons name="pencil-outline" size={16} color={Colors.light.primary} />
                <Text style={s.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {editMode ? (
            <>
              <EditField label="Name" value={editData.name} onChange={v => setEditData(p => ({ ...p, name: v }))} />
              <EditField label="Phone" value={editData.contactPhone} onChange={v => setEditData(p => ({ ...p, contactPhone: v }))} keyboardType="phone-pad" />
              <EditField label="Email" value={editData.email} onChange={v => setEditData(p => ({ ...p, email: v }))} keyboardType="email-address" autoCapitalize="none" />
              <EditField label="Address" value={editData.address} onChange={v => setEditData(p => ({ ...p, address: v }))} multiline />
              <EditField label="City" value={editData.city} onChange={v => setEditData(p => ({ ...p, city: v }))} />
              <EditField label="State" value={editData.state} onChange={v => setEditData(p => ({ ...p, state: v }))} />
              <EditField label="Pincode" value={editData.pincode} onChange={v => setEditData(p => ({ ...p, pincode: v }))} keyboardType="number-pad" />
              <View style={s.editActions}>
                <TouchableOpacity style={[s.cancelBtn, { borderColor: colors.border }]} onPress={() => setEditMode(false)}>
                  <Text style={[s.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && s.btnDim]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={[s.bankName, { color: colors.text }]}>{bank.name}</Text>
              <Text style={[s.bankDetail, { color: colors.muted }]}>{bank.address ?? ''}{bank.address ? ', ' : ''}{bank.location.city}, {bank.location.state}</Text>
              {bank.contactPhone && <Text style={[s.bankDetail, { color: colors.muted }]}>{bank.contactPhone}</Text>}
              {bank.email       && <Text style={[s.bankDetail, { color: colors.muted }]}>{bank.email}</Text>}
              {bank.licenseNumber && <Text style={[s.bankDetail, { color: colors.muted }]}>License: {bank.licenseNumber}</Text>}
            </>
          )}
        </View>

        {/* ── STATS ROW ── */}
        <View style={[s.statsRow, { backgroundColor: colors.card }]}>
          <StatCell icon="water-outline" label="Inventory" value={invTotal} />
          <StatCell icon="hourglass-outline" label="Pending" value={pendingReq} color="#F39C12" />
          <StatCell icon="time-outline" label="In Progress" value={inProgressReq} color="#E67E22" />
          <StatCell icon="checkmark-done-outline" label="Fulfilled" value={completedReq} color="#2ECC71" />
        </View>

        {/* ── INVENTORY BUTTON ── */}
        <TouchableOpacity
          style={s.inventoryBtn}
          onPress={() => router.push(`/blood-bank/inventory?bankId=${bankId}`)}
          activeOpacity={0.85}
        >
          <Ionicons name="flask-outline" size={20} color="#fff" />
          <Text style={s.inventoryBtnText}>Manage Inventory ({invTotal} units)</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {/* ── DEV VERIFY (development builds only; hidden in production) ── */}
        {__DEV__ && vStatus !== 'VERIFIED' && (
          <TouchableOpacity style={s.devBtn} onPress={handleDevVerify}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#6C3483" />
            <Text style={s.devBtnText}>Dev: Mark Verified</Text>
          </TouchableOpacity>
        )}

        {/* ── INCOMING REQUESTS ── */}
        <Text style={[s.sectionTitle, { color: colors.muted }]}>Incoming Requests</Text>
        {requests.length === 0 ? (
          <View style={[s.emptyBox, { backgroundColor: colors.card }]}>
            <Ionicons name="inbox-outline" size={36} color={colors.muted} />
            <Text style={[s.emptyText, { color: colors.muted }]}>No incoming bank requests yet.</Text>
          </View>
        ) : (
          requests.map(req => {
            console.log('[BloodBankUI] rendering incoming request:', req.id, req.status);
            return (
              <RequestCard
                key={req.id}
                req={req}
                actionLoading={actionLoading}
                onAccept={handleAccept}
                onReject={handleReject}
                onComplete={openProofModal}
              />
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── PROOF OF DELIVERY MODAL ── */}
      <Modal
        visible={proofModal}
        transparent
        animationType="slide"
        onRequestClose={() => setProofModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
            <View style={[s.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[s.modalTitle, { color: colors.text }]}>Proof of Delivery</Text>
            <Text style={[s.modalSub, { color: colors.muted }]}>Optional — you can complete without proof.</Text>

            {proofImage ? (
              <View style={s.proofImgWrap}>
                <Image source={{ uri: proofImage }} style={s.proofImg} />
                <TouchableOpacity style={s.proofImgRemove} onPress={() => setProofImage(null)}>
                  <Ionicons name="close-circle" size={22} color="#E74C3C" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.proofImgActions}>
                <TouchableOpacity style={[s.proofImgBtn, { borderColor: Colors.light.primary }]} onPress={() => pickImage('camera')}>
                  <Ionicons name="camera-outline" size={20} color={Colors.light.primary} />
                  <Text style={s.proofImgBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.proofImgBtn, { borderColor: Colors.light.primary }]} onPress={() => pickImage('library')}>
                  <Ionicons name="image-outline" size={20} color={Colors.light.primary} />
                  <Text style={s.proofImgBtnText}>Gallery</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={[s.fieldLabel, { color: colors.muted }]}>Notes (optional)</Text>
            <TextInput
              style={[s.input, s.inputMulti, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
              value={proofNote}
              onChangeText={setProofNote}
              placeholder="Delivery notes…"
              placeholderTextColor={colors.inputPlaceholder}
              multiline
            />

            <View style={s.modalActions}>
              <TouchableOpacity style={[s.modalCancelBtn, { borderColor: colors.border }]} onPress={() => setProofModal(false)}>
                <Text style={[s.cancelBtnText, { color: colors.muted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirmBtn, (completing || uploading) && s.btnDim]}
                onPress={handleComplete}
                disabled={completing || uploading}
              >
                {completing || uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.saveBtnText}>Mark Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Request Card ──────────────────────────────────────────────────────────────

function RequestCard({
  req, actionLoading, onAccept, onReject, onComplete,
}: {
  req: BankRequest;
  actionLoading: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const { colors } = useTheme();
  const canAct    = ['ACTIVE', 'OPEN'].includes(req.status);
  const canFulfil = req.status === 'IN_PROGRESS';

  return (
    <View style={[s.reqCard, { backgroundColor: colors.card }]}>
      {/* Top row */}
      <View style={s.reqTopRow}>
        <View style={[s.bgBadge, { backgroundColor: colors.surface }]}>
          <Text style={s.bgBadgeText}>{req.bloodGroup}</Text>
        </View>
        <View style={s.reqMeta}>
          <Text style={[s.reqName, { color: colors.text }]}>{req.requester.name}</Text>
          <Text style={[s.reqTime, { color: colors.muted }]}>{timeAgo(req.createdAt)}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: (STATUS_COLOR[req.status] ?? '#95A5A6') + '20' }]}>
          <Text style={[s.statusPillText, { color: STATUS_COLOR[req.status] ?? '#95A5A6' }]}>
            {STATUS_LABEL[req.status] ?? req.status}
          </Text>
        </View>
      </View>

      {/* Details */}
      <View style={s.reqDetails}>
        <DetailChip icon="water" label={`${req.units} unit${req.units !== 1 ? 's' : ''}`} />
        <DetailChip
          icon="alert-circle"
          label={req.emergencyLevel ?? 'MEDIUM'}
          color={PRIORITY_COLOR[req.emergencyLevel] ?? '#F1C40F'}
        />
      </View>
      {req.notes && !req.notes.startsWith('[Bank declined]') && (
        <Text style={[s.reqNotes, { color: colors.muted }]} numberOfLines={2}>{req.notes}</Text>
      )}

      {/* Actions */}
      {canAct && (
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.rejectBtn, actionLoading === req.id + '_reject' && s.btnDim]}
            onPress={() => onReject(req.id)}
            disabled={!!actionLoading}
          >
            {actionLoading === req.id + '_reject'
              ? <ActivityIndicator color="#E74C3C" size="small" />
              : <Text style={s.rejectBtnText}>Decline</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.acceptBtn, actionLoading === req.id + '_accept' && s.btnDim]}
            onPress={() => onAccept(req.id)}
            disabled={!!actionLoading}
          >
            {actionLoading === req.id + '_accept'
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.acceptBtnText}>Accept</Text>}
          </TouchableOpacity>
        </View>
      )}
      {canFulfil && (
        <TouchableOpacity style={s.fulfillBtn} onPress={() => onComplete(req.id)} disabled={!!actionLoading}>
          <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
          <Text style={s.fulfillBtnText}>Mark Complete</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function DetailChip({ icon, label, color = Colors.light.primary }: { icon: string; label: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[s.detailChip, { backgroundColor: colors.surface }]}>
      <Ionicons name={icon as any} size={13} color={color} />
      <Text style={[s.detailChipText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={s.backBtn}>
        <Ionicons name="arrow-back" size={24} color={colors.icon} />
      </TouchableOpacity>
      <Text style={[s.headerTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

function StatCell({ icon, label, value, color = Colors.light.primary }: {
  icon: string; label: string; value: number; color?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.statCell}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[s.statVal, { color }]}>{value}</Text>
      <Text style={[s.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

function EditField({ label, value, onChange, multiline, keyboardType, autoCapitalize }: {
  label: string; value: string; onChange: (v: string) => void;
  multiline?: boolean; keyboardType?: any; autoCapitalize?: any;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[s.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        style={[s.input, multiline && s.inputMulti, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
        value={value} onChangeText={onChange}
        placeholderTextColor={colors.inputPlaceholder} multiline={multiline}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize ?? 'words'}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  errText:   { fontFamily: 'Poppins_500Medium', fontSize: 15, color: '#888', marginTop: 12, textAlign: 'center' },
  retryBtn:  { marginTop: 20, backgroundColor: Colors.light.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 },
  retryBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#fff' },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn:     { padding: 5 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#333', flex: 1, textAlign: 'center', marginHorizontal: 10 },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  // Profile card
  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  vBadge:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  vBadgeText:    { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },
  editBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText:   { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: Colors.light.primary },
  bankName:      { fontFamily: 'Poppins_700Bold', fontSize: 17, color: '#222', marginBottom: 4 },
  bankDetail:    { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#666', marginBottom: 2 },
  editActions:   { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn:     { flex: 1, borderWidth: 1.5, borderColor: '#DDD', borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  cancelBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#666' },
  saveBtn:       { flex: 1, backgroundColor: Colors.light.primary, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  saveBtnText:   { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#fff' },
  btnDim:        { opacity: 0.6 },

  fieldLabel: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#555', marginBottom: 5 },
  input: {
    borderWidth: 1.5, borderColor: '#E8E8E8', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#333', backgroundColor: '#FAFAFA',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  // Stats
  statsRow: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 12,
    marginBottom: 14, gap: 4,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5,
  },
  statCell:  { flex: 1, alignItems: 'center', gap: 2 },
  statVal:   { fontFamily: 'Poppins_700Bold', fontSize: 18, color: Colors.light.primary },
  statLabel: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#888', textAlign: 'center' },

  // Inventory button
  inventoryBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.light.primary,
    borderRadius: 14, padding: 15, marginBottom: 10, gap: 10,
    elevation: 4, shadowColor: Colors.light.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  inventoryBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#fff', flex: 1 },

  // Dev verify
  devBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: '#D7BDE2', backgroundColor: '#F9F0FF', marginBottom: 14,
  },
  devBtnText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#6C3483' },

  // Requests
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyBox:     { backgroundColor: '#fff', borderRadius: 14, padding: 30, alignItems: 'center', gap: 8 },
  emptyText:    { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#bbb' },

  reqCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5,
  },
  reqTopRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  bgBadge:     { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  bgBadgeText: { fontFamily: 'Poppins_700Bold', fontSize: 13, color: Colors.light.primary },
  reqMeta:     { flex: 1 },
  reqName:     { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#222' },
  reqTime:     { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#bbb', marginTop: 1 },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusPillText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },
  reqDetails:  { flexDirection: 'row', gap: 8, marginBottom: 8 },
  detailChip:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9FAFB', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  detailChipText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: Colors.light.primary },
  reqNotes:    { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginBottom: 8 },

  actionRow:   { flexDirection: 'row', gap: 10, marginTop: 8 },
  rejectBtn:   { flex: 1, borderWidth: 1.5, borderColor: '#E74C3C', borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  rejectBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#E74C3C' },
  acceptBtn:   { flex: 2, backgroundColor: Colors.light.primary, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  acceptBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#fff' },
  fulfillBtn:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#2ECC71', borderRadius: 10, paddingVertical: 10, marginTop: 8,
  },
  fulfillBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#fff' },

  // Proof modal
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 16 },
  sheetHandle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 16 },
  modalTitle:    { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#222', marginBottom: 4 },
  modalSub:      { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#888', marginBottom: 20 },
  proofImgWrap:  { position: 'relative', marginBottom: 16, alignSelf: 'flex-start' },
  proofImg:      { width: 120, height: 90, borderRadius: 10 },
  proofImgRemove:{ position: 'absolute', top: -8, right: -8 },
  proofImgActions:{ flexDirection: 'row', gap: 10, marginBottom: 16 },
  proofImgBtn:   {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Colors.light.primary, borderRadius: 10, paddingVertical: 10,
  },
  proofImgBtnText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: Colors.light.primary },
  modalActions:  { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancelBtn:{ flex: 1, borderWidth: 1.5, borderColor: '#DDD', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  modalConfirmBtn:{ flex: 2, backgroundColor: '#2ECC71', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
});
