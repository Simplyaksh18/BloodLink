/**
 * Developer QA Panel — dev builds only (__DEV__ === true).
 * Provides quick access to test actions without manual DB seeding.
 * This file is not tree-shaken in production but every backend endpoint
 * it calls returns 403 if NODE_ENV === 'production'.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Redirect } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { userStorage } from '../../services/apiClient';
import { donorStatusService } from '../../services/donorStatusService';
import { verificationService } from '../../services/verificationService';
import { requestService } from '../../services/bloodService';
import { devQaService } from '../../services/devQaService';
import { authService } from '../../services/authService';

// Dev-only fallback coordinates (Coimbatore)
const DEV_LAT = 11.0168;
const DEV_LNG = 76.9558;
const DEV_CITY = 'Coimbatore';

const MAX_LOGS = 30;

type LogEntry = { ts: string; label: string; ok: boolean; detail: string };

function ts(): string {
  return new Date().toLocaleTimeString();
}

export default function DevQaScreen() {
  // Production hard-stop: deep-linking to /(modals)/dev-qa in a release
  // build must never reveal the QA panel, even if the entry point in Profile
  // is compiled out.
  if (!__DEV__) {
    return <Redirect href="/(tabs)" />;
  }

  const router = useRouter();
  const { user, setUser } = useAuthStore();

  const [donorStatus, setDonorStatus] = useState<any>(null);
  const [myRequests, setMyRequests]   = useState<any[]>([]);
  const [nearbyReqs, setNearbyReqs]   = useState<any[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [proofNote, setProofNote] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const pushLog = useCallback((label: string, ok: boolean, detail: string) => {
    setLogs(prev => [{ ts: ts(), label, ok, detail }, ...prev].slice(0, MAX_LOGS));
  }, []);

  const run = useCallback(
    async (key: string, label: string, fn: () => Promise<any>) => {
      setLoading(p => ({ ...p, [key]: true }));
      try {
        const result = await fn();
        const msg = result?.message ?? result?.data?.message ?? 'OK';
        pushLog(label, true, msg);
        return result;
      } catch (err: any) {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Error';
        pushLog(label, false, msg);
      } finally {
        setLoading(p => ({ ...p, [key]: false }));
      }
    },
    [pushLog]
  );

  const confirm = (title: string, body: string, onConfirm: () => void) => {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: onConfirm },
    ]);
  };

  // ── Donor actions ──────────────────────────────────────────────────────────

  const refreshDonorStatus = async () => {
    const res = await run('ds_refresh', 'Refresh Donor Status', () => donorStatusService.getStatus());
    if (res?.success) setDonorStatus(res.data);
  };

  const refreshProfile = async () => {
    const res = await run('prof_refresh', 'Refresh Profile', () => authService.getProfile());
    if (res?.success && res.data) {
      // Re-persist fresh profile to SecureStore and update in-memory store
      await userStorage.set(res.data);
      setUser(res.data);
    }
  };

  const forceActive = async () => {
    const res = await run('force_active', 'Force Active Donor', () => devQaService.forceActiveDonor());
    if (res?.success) { await userStorage.remove(); await refreshProfile(); await refreshDonorStatus(); }
  };

  const resetDonor = () =>
    confirm('Reset Donor State', 'Wipes all donor fields to NEVER_DONATED. Continue?', async () => {
      const res = await run('donor_reset', 'Reset Donor State', () => donorStatusService.devReset());
      if (res?.success) {
        console.log('[QAReset] backend reset success');
        console.log('[QAReset] clearing local donor caches');
        // Evict SecureStore user cache so the next getProfile() returns fresh data,
        // not the cached blob that still has isDonorEligible=true / isDonor=true.
        await userStorage.remove();
        await refreshProfile();
        await refreshDonorStatus();
        console.log('[QAReset] refreshed profile/status');
      }
    });

  const deferDonor = async () => {
    const res = await run('donor_defer', 'Simulate Alcohol Deferral (24h)', () => devQaService.deferDonor());
    if (res?.success) { await userStorage.remove(); await refreshProfile(); await refreshDonorStatus(); }
  };

  // ── Verification actions ───────────────────────────────────────────────────

  const refreshVerif = async () => {
    await run('verif_refresh', 'Refresh Verification', () => verificationService.getStatus());
  };

  const markAllVerified = () =>
    run('verif_mark', 'Mark All Verified', () => devQaService.markAllVerified());

  const resetVerification = () =>
    confirm('Reset Verification', 'Deletes all verification records for this user. Continue?', () =>
      run('verif_reset', 'Reset Verification', () => devQaService.resetVerification())
    );

  // ── Request actions ────────────────────────────────────────────────────────

  const refreshMyRequests = async () => {
    const res = await run('req_refresh_mine', 'Refresh My Requests', () => requestService.getMyRequests());
    if (res?.success && res.data) {
      const items = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setMyRequests(items);
      if (items.length > 0 && !selectedReqId) setSelectedReqId(items[0].id);
    }
  };

  const refreshNearby = async () => {
    const res = await run('req_refresh_nearby', 'Refresh Nearby Requests', () =>
      requestService.getFilteredRequests()
    );
    if (res?.success && res.data) {
      const items = res.data?.data ?? [];
      setNearbyReqs(items);
    }
  };

  const createRequest = async (bloodGroup: string, level: 'critical' | 'stable') => {
    await run(
      `create_req_${bloodGroup}`,
      `Create ${bloodGroup} ${level} request`,
      () => requestService.createRequest({
        bloodGroup: bloodGroup as any,
        units: 1,
        hospitalName: 'Dev Test Hospital',
        address: 'Dev Test Hospital',
        city: DEV_CITY,
        urgency: level === 'critical' ? 'RED' : 'GREEN',
        emergencyLevel: level,
        contactPhone: user?.phone ?? '9999999999',
        hospitalLatitude: DEV_LAT,
        hospitalLongitude: DEV_LNG,
        requiredBy: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        documents: [],
      } as any)
    );
    await refreshMyRequests();
  };

  const cancelSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    confirm('Cancel Request', `Cancel request ${selectedReqId.slice(-6)}?`, () =>
      run('cancel_req', 'Cancel Request', () => requestService.cancelRequest(selectedReqId))
        .then(() => refreshMyRequests())
    );
  };

  const fulfillSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    confirm('Fulfill Request', `Mark request ${selectedReqId.slice(-6)} as fulfilled?`, () =>
      run('fulfill_req', 'Fulfill Request', () => requestService.fulfillRequest(selectedReqId))
        .then(() => refreshMyRequests())
    );
  };

  const expireSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    confirm('Expire Request', `Force-expire request ${selectedReqId.slice(-6)}?`, () =>
      run('expire_req', 'Expire Request', () => devQaService.expireRequest(selectedReqId))
        .then(() => refreshMyRequests())
    );
  };

  // ── Donor response actions ─────────────────────────────────────────────────

  const acceptSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    run('accept', 'Accept Request', () => requestService.respondToRequest(selectedReqId, 'ACCEPTED'));
  };

  const declineSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    run('decline', 'Decline Request', () => requestService.respondToRequest(selectedReqId, 'DECLINED'));
  };

  const submitProofSelected = () => {
    if (!selectedReqId) { Alert.alert('No request selected'); return; }
    console.log('[DonationProof] submit pressed');
    run('proof', 'Submit Donation Proof', () =>
      requestService.submitProof(selectedReqId, proofNote || 'Dev QA proof submission')
    );
  };

  const L = loading;
  const userId = (user as any)?.id ?? (user as any)?.userId ?? '—';

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Developer QA Panel</Text>
          <Text style={s.headerSub}>dev build only</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── 1. User Info Card ── */}
        <Section title="Current User">
          <InfoRow label="userId"         value={userId} />
          <InfoRow label="phone"          value={user?.phone ?? '—'} />
          <InfoRow label="email"          value={user?.email ?? '—'} />
          <InfoRow label="bloodGroup"     value={user?.bloodGroup ?? '—'} />
          <InfoRow label="donorStatus"    value={donorStatus?.donorStatus ?? (user as any)?.donorStatus ?? '—'} />
          <InfoRow label="isEligible"     value={String(donorStatus?.isEligible ?? (user as any)?.isDonorEligible ?? '—')} />
          <InfoRow label="nextEligible"   value={donorStatus?.nextEligibleDate ?? '—'} />
          <InfoRow label="totalDonations" value={String(donorStatus?.totalDonations ?? 0)} />
          <Row>
            <Btn label="Refresh Profile"  key="rp"  loading={L.prof_refresh}  onPress={refreshProfile} />
            <Btn label="Refresh Status"   key="rds" loading={L.ds_refresh}    onPress={refreshDonorStatus} />
          </Row>
        </Section>

        {/* ── 2. Donor Actions ── */}
        <Section title="Donor Actions">
          <Row>
            <Btn label="Force Active"   loading={L.force_active}  onPress={forceActive}  color="#27AE60" />
            <Btn label="Defer 24h"      loading={L.donor_defer}   onPress={deferDonor}   color="#E67E22" />
          </Row>
          <Row>
            <Btn label="Reset State ⚠"  loading={L.donor_reset}  onPress={resetDonor}   color="#C0392B" />
          </Row>
        </Section>

        {/* ── 3. Verification Actions ── */}
        <Section title="Verification Actions">
          <Row>
            <Btn label="Refresh"          loading={L.verif_refresh} onPress={refreshVerif} />
            <Btn label="Mark All Verified" loading={L.verif_mark}   onPress={markAllVerified} color="#27AE60" />
          </Row>
          <Row>
            <Btn label="Reset All ⚠"      loading={L.verif_reset}  onPress={resetVerification} color="#C0392B" />
          </Row>
        </Section>

        {/* ── 4. Request Actions ── */}
        <Section title="Request Actions">
          <Row>
            <Btn label="Refresh Mine"   loading={L.req_refresh_mine}   onPress={refreshMyRequests} />
            <Btn label="Refresh Nearby" loading={L.req_refresh_nearby} onPress={refreshNearby} />
          </Row>
          <Row>
            <Btn label="+ O+ Critical" loading={L['create_req_O+']}   onPress={() => createRequest('O+', 'critical')} color="#C0392B" />
            <Btn label="+ B+ Normal"   loading={L['create_req_B+']}   onPress={() => createRequest('B+', 'stable')}   color="#2980B9" />
          </Row>

          {/* Request selector */}
          <Text style={s.subLabel}>Select a request (tap to select):</Text>
          {myRequests.length === 0 && nearbyReqs.length === 0 ? (
            <Text style={s.emptyHint}>No requests loaded. Tap Refresh.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
              {[...myRequests, ...nearbyReqs.filter(r => !myRequests.find(m => m.id === r.id))].map(req => (
                <TouchableOpacity
                  key={req.id}
                  style={[s.chip, selectedReqId === req.id && s.chipSelected]}
                  onPress={() => setSelectedReqId(req.id)}
                >
                  <Text style={[s.chipText, selectedReqId === req.id && s.chipTextSelected]}>
                    {req.bloodGroup} · {(req.rawStatus ?? req.status ?? '?').slice(0, 3).toUpperCase()} · …{req.id.slice(-4)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <Text style={s.selectedLabel}>
            Selected: {selectedReqId ? `…${selectedReqId.slice(-8)}` : 'none'}
          </Text>

          <Row>
            <Btn label="Cancel ⚠"  loading={L.cancel_req}  onPress={cancelSelected}  color="#C0392B" />
            <Btn label="Fulfill ⚠" loading={L.fulfill_req} onPress={fulfillSelected} color="#27AE60" />
            <Btn label="Expire ⚠"  loading={L.expire_req}  onPress={expireSelected}  color="#E67E22" />
          </Row>
        </Section>

        {/* ── 5. Donor Response Actions ── */}
        <Section title="Donor Response">
          <Row>
            <Btn label="Accept"   loading={L.accept}  onPress={acceptSelected}  color="#27AE60" />
            <Btn label="Decline"  loading={L.decline} onPress={declineSelected} color="#E67E22" />
          </Row>
          <Text style={s.subLabel}>Proof note (optional):</Text>
          <TextInput
            style={s.proofInput}
            placeholder="e.g. Donated at City Hospital"
            value={proofNote}
            onChangeText={setProofNote}
          />
          <Row>
            <Btn label="Submit Proof" loading={L.proof} onPress={submitProofSelected} color="#2980B9" />
          </Row>
        </Section>

        {/* ── 6. Log Panel ── */}
        <Section title={`Log (last ${logs.length})`}>
          {logs.length === 0 ? (
            <Text style={s.emptyHint}>No actions run yet.</Text>
          ) : (
            logs.map((entry, i) => (
              <View key={i} style={[s.logRow, entry.ok ? s.logOk : s.logErr]}>
                <Text style={s.logTs}>{entry.ts}</Text>
                <Text style={[s.logLabel, !entry.ok && { color: '#E74C3C' }]}>{entry.label}</Text>
                <Text style={s.logDetail} numberOfLines={2}>{entry.detail}</Text>
              </View>
            ))
          )}
          {logs.length > 0 && (
            <TouchableOpacity onPress={() => setLogs([])} style={s.clearLogBtn}>
              <Text style={s.clearLogText}>Clear logs</Text>
            </TouchableOpacity>
          )}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

function Btn({
  label, loading, onPress, color = '#555',
}: {
  label: string;
  loading?: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <TouchableOpacity
      style={[s.btn, { borderColor: color + '55' }]}
      onPress={onPress}
      disabled={loading}
    >
      {loading
        ? <ActivityIndicator size="small" color={color} />
        : <Text style={[s.btnText, { color }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F5F7' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#1A1A2E', gap: 8,
  },
  backBtn: { padding: 6 },
  headerCenter: { flex: 1 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#fff' },
  headerSub: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#aaa' },

  content: { padding: 12, paddingBottom: 60 },

  section: {
    backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#E8E8E8',
  },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold', fontSize: 13, color: '#1A1A2E',
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  infoLabel: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#666', flex: 1 },
  infoValue: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#222', flex: 2, textAlign: 'right' },

  row: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },

  btn: {
    flex: 1, minWidth: 80, paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, backgroundColor: '#FAFAFA',
    alignItems: 'center', justifyContent: 'center',
  },
  btnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 12 },

  subLabel: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#888', marginTop: 10, marginBottom: 4 },
  emptyHint: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#bbb', marginVertical: 4 },

  chipScroll: { maxHeight: 48, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#ddd', backgroundColor: '#F5F5F5',
    marginRight: 6,
  },
  chipSelected: { backgroundColor: '#1A1A2E', borderColor: '#1A1A2E' },
  chipText: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#555' },
  chipTextSelected: { color: '#fff' },

  selectedLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#888', marginBottom: 6 },

  proofInput: {
    borderWidth: 1, borderColor: '#E1E4E8', borderRadius: 8,
    padding: 10, fontFamily: 'Poppins_400Regular', fontSize: 12,
    backgroundColor: '#FAFAFA', marginBottom: 4,
  },

  logRow: {
    borderRadius: 6, padding: 8, marginBottom: 4,
    borderLeftWidth: 3,
  },
  logOk:  { backgroundColor: '#F0FFF4', borderLeftColor: '#27AE60' },
  logErr: { backgroundColor: '#FFF5F5', borderLeftColor: '#E74C3C' },
  logTs:  { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#aaa', marginBottom: 1 },
  logLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#222' },
  logDetail: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#555', marginTop: 2 },

  clearLogBtn: { alignSelf: 'center', marginTop: 4 },
  clearLogText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#aaa' },
});
