import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { bloodBankService, CreateBankPayload, BankWithStats } from '../../services/bloodService';
import { timeAgo } from '../../utils/timeAgo';

// ─── Types ─────────────────────────────────────────────────────────────────────

type FormState = {
  name: string; licenseNumber: string; contactPhone: string;
  email: string; address: string; city: string; state: string; pincode: string;
};

const EMPTY_FORM: FormState = {
  name: '', licenseNumber: '', contactPhone: '',
  email: '', address: '', city: '', state: '', pincode: '',
};

// ─── Dashboard Screen ──────────────────────────────────────────────────────────

export default function MyBloodBankScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const isFirstLoad = useRef(true);

  const [banks, setBanks]         = useState<BankWithStats[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // Register-new form
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm]     = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Link-existing flow
  const [showLink, setShowLink]       = useState(false);
  const [linkCity, setLinkCity]       = useState('');
  const [linkResults, setLinkResults] = useState<BankWithStats[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linking, setLinking]         = useState<string | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setFetchError(false);
    try {
      const res = await bloodBankService.getMyBanks();
      if (res.success && res.data) {
        console.log('[BloodBankUI] dashboard banks count:', res.data.length);
        res.data.forEach(b => {
          console.log('[BloodBankStats] bank:', b.name,
            '| inventory:', b.inventoryUnits,
            '| pending:', b.pendingRequests,
            '| completed:', b.fulfilledRequests);
          console.log('[BloodBankLivesServed] bank:', b.name, '| fulfilledRequests:', b.fulfilledRequests);
        });
        setBanks(res.data);
      }
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        console.error('[BloodBankUI] dashboard fetch error:', err?.message);
        setFetchError(true);
      } else {
        setBanks([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log('[BloodBankUI] dashboard focused');
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        setLoading(true);
      }
      refresh();
    }, [refresh])
  );

  function setField(key: keyof FormState, v: string) {
    setForm(prev => ({ ...prev, [key]: v }));
  }

  // ─── Register ───────────────────────────────────────────────────────────────

  const handleRegister = async () => {
    const { name, licenseNumber, contactPhone, address, city, state } = form;
    if (!name.trim() || !licenseNumber.trim() || !contactPhone.trim() || !address.trim() || !city.trim() || !state.trim()) {
      Alert.alert('Required Fields', 'Please fill: Name, License, Phone, Address, City, State.');
      return;
    }
    setSaving(true);
    try {
      const payload: CreateBankPayload = {
        name: name.trim(), licenseNumber: licenseNumber.trim(),
        contactPhone: contactPhone.trim(), email: form.email.trim() || undefined,
        address: address.trim(), city: city.trim(),
        state: state.trim(), pincode: form.pincode.trim() || undefined,
      };
      const res = await bloodBankService.createMyBank(payload);
      if (res.success) {
        console.log('[BloodBankUI] create bank success:', res.data?.id);
        setShowRegister(false);
        setForm(EMPTY_FORM);
        setLoading(true);
        await refresh();
        Alert.alert('Registered!', 'Your blood bank is pending review.');
      } else {
        Alert.alert('Failed', res.message ?? 'Please try again.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Registration failed.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Link existing ──────────────────────────────────────────────────────────

  const handleSearchUnowned = async () => {
    setLinkSearching(true); setLinkResults([]);
    try {
      const res = await bloodBankService.getUnownedBanks(linkCity.trim() || undefined);
      if (res.success && res.data) {
        setLinkResults(res.data as any);
        if (res.data.length === 0) Alert.alert('No Results', 'No unowned banks found for that city.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Search failed.');
    } finally {
      setLinkSearching(false);
    }
  };

  const handleLink = async (bankId: string, bankName: string) => {
    Alert.alert('Link Blood Bank', `Link "${bankName}" to your account?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Link', onPress: async () => {
          setLinking(bankId);
          try {
            const res = await bloodBankService.linkBankOwner(bankId);
            if (res.success) {
              console.log('[BloodBankUI] bank linked:', res.data?.id);
              setShowLink(false); setLinkResults([]);
              setLoading(true); await refresh();
            } else {
              Alert.alert('Failed', res.message ?? 'Could not link bank.');
            }
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Link failed.');
          } finally {
            setLinking(null);
          }
        },
      },
    ]);
  };

  // ─── Render guards ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <Header title="Blood Bank Management" onBack={() => router.back()} />
        <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <Header title="Blood Bank Management" onBack={() => router.back()} />
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text style={[s.errText, { color: colors.muted }]}>Could not load your blood banks</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); refresh(); }}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────────

  const activeMode = showRegister ? 'register' : showLink ? 'link' : null;

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      <Header
        title={activeMode === 'register' ? 'Register Blood Bank' : activeMode === 'link' ? 'Link Existing Bank' : 'Blood Bank Management'}
        onBack={activeMode ? () => { setShowRegister(false); setShowLink(false); } : () => router.back()}
      />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── REGISTER FORM ── */}
        {showRegister && (
          <>
            <View style={[s.card, { backgroundColor: colors.card }]}>
              <Text style={[s.cardTitle, { color: colors.text }]}>Registration Details</Text>
              <Field label="Blood Bank Name *" value={form.name} onChange={v => setField('name', v)} />
              <Field label="License Number *" value={form.licenseNumber} onChange={v => setField('licenseNumber', v)} autoCapitalize="characters" />
              <Field label="Contact Phone *" value={form.contactPhone} onChange={v => setField('contactPhone', v)} keyboardType="phone-pad" />
              <Field label="Email" value={form.email} onChange={v => setField('email', v)} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Address *" value={form.address} onChange={v => setField('address', v)} multiline />
              <Field label="City *" value={form.city} onChange={v => setField('city', v)} />
              <Field label="State *" value={form.state} onChange={v => setField('state', v)} />
              <Field label="Pincode" value={form.pincode} onChange={v => setField('pincode', v)} keyboardType="number-pad" />
            </View>
            <TouchableOpacity style={[s.primaryBtn, saving && s.btnDim]} onPress={handleRegister} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Register Blood Bank</Text>}
            </TouchableOpacity>
          </>
        )}

        {/* ── LINK EXISTING ── */}
        {showLink && (
          <>
            <View style={[s.card, { backgroundColor: colors.card }]}>
              <Text style={[s.cardTitle, { color: colors.text }]}>Search Unowned Banks</Text>
              <Text style={[s.cardSub, { color: colors.muted }]}>Find blood banks not yet claimed by any owner.</Text>
              <View style={s.searchRow}>
                <TextInput
                  style={[s.input, { flex: 1, backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                  value={linkCity}
                  onChangeText={setLinkCity}
                  placeholder="City (e.g. Chennai)"
                  placeholderTextColor={colors.inputPlaceholder}
                  autoCapitalize="words"
                />
                <TouchableOpacity style={s.searchBtn} onPress={handleSearchUnowned} disabled={linkSearching}>
                  {linkSearching ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={20} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>
            {linkResults.map(b => (
              <View key={b.id} style={[s.linkCard, { backgroundColor: colors.card }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.linkName, { color: colors.text }]}>{b.name}</Text>
                  <Text style={[s.linkSub, { color: colors.muted }]}>{b.location.city}, {b.location.state}</Text>
                  <Text style={[s.linkSub, { color: colors.muted, marginTop: 2 }]}>License: {b.licenseNumber ?? 'N/A'}</Text>
                </View>
                <TouchableOpacity
                  style={[s.linkBtn, linking === b.id && s.btnDim]}
                  onPress={() => handleLink(b.id, b.name)}
                  disabled={linking === b.id}
                >
                  {linking === b.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.linkBtnText}>Claim</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── BANK CARDS ── */}
        {!activeMode && (
          <>
            {banks.length > 0 && (
              <View style={s.section}>
                <Text style={[s.sectionLabel, { color: colors.muted }]}>Your Blood Banks</Text>
                {banks.map(bank => (
                  <BankCard
                    key={bank.id}
                    bank={bank}
                    onManage={() => router.push(`/blood-bank/bank-manage?bankId=${bank.id}`)}
                  />
                ))}
              </View>
            )}

            {/* CTA row — always visible */}
            <View style={s.ctaSection}>
              {banks.length > 0 && <Text style={[s.sectionLabel, { color: colors.muted }]}>Add Another</Text>}
              <TouchableOpacity style={[s.ctaBtn, { backgroundColor: colors.card }]} onPress={() => setShowRegister(true)} activeOpacity={0.85}>
                <View style={[s.ctaIcon, { backgroundColor: colors.surface }]}><Ionicons name="add-circle-outline" size={22} color={Colors.light.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.ctaTitle, { color: colors.text }]}>Register New Blood Bank</Text>
                  <Text style={[s.ctaSub, { color: colors.muted }]}>Submit a new bank for verification</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctaBtn, { backgroundColor: colors.card }]} onPress={() => setShowLink(true)} activeOpacity={0.85}>
                <View style={[s.ctaIcon, { backgroundColor: colors.surface }]}><Ionicons name="link-outline" size={22} color="#6C3483" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.ctaTitle, { color: colors.text }]}>Link Existing Blood Bank</Text>
                  <Text style={[s.ctaSub, { color: colors.muted }]}>Claim an unowned bank in the system</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Bank Card ─────────────────────────────────────────────────────────────────

function BankCard({ bank, onManage }: { bank: BankWithStats; onManage: () => void }) {
  const { colors } = useTheme();
  const vStatus = bank.verificationStatus ?? (bank.isVerified ? 'VERIFIED' : 'PENDING_REVIEW');
  const verified = vStatus === 'VERIFIED';

  const VS_COLOR: Record<string, string> = {
    VERIFIED: '#2ECC71', PENDING_REVIEW: '#F39C12', REJECTED: '#E74C3C',
  };
  const VS_LABEL: Record<string, string> = {
    VERIFIED: 'Verified', PENDING_REVIEW: 'Pending', REJECTED: 'Rejected',
  };

  return (
    <View style={[s.bankCard, { backgroundColor: colors.card }]}>
      {/* Header row */}
      <View style={s.bankCardHeader}>
        <View style={[s.vBadge, { backgroundColor: (VS_COLOR[vStatus] ?? '#F39C12') + '20', borderColor: VS_COLOR[vStatus] ?? '#F39C12' }]}>
          <Ionicons name={verified ? 'checkmark-circle' : 'time-outline'} size={13} color={VS_COLOR[vStatus] ?? '#F39C12'} />
          <Text style={[s.vBadgeText, { color: VS_COLOR[vStatus] ?? '#F39C12' }]}>{VS_LABEL[vStatus] ?? 'Pending'}</Text>
        </View>
        <Text style={[s.bankUpdated, { color: colors.muted }]}>{timeAgo(bank.lastUpdated)}</Text>
      </View>

      <Text style={[s.bankName, { color: colors.text }]}>{bank.name}</Text>
      <Text style={[s.bankCity, { color: colors.muted }]}>{bank.location.city}, {bank.location.state}</Text>

      {/* Stats row */}
      <View style={s.statsRow}>
        <StatChip icon="water-outline" label="Inventory" value={bank.inventoryUnits} />
        <StatChip icon="hourglass-outline" label="Pending" value={bank.pendingRequests} color="#F39C12" />
        <StatChip icon="checkmark-done-outline" label="Fulfilled" value={bank.fulfilledRequests} color="#2ECC71" />
      </View>

      {/* Blood groups */}
      {bank.availableBloodGroups.length > 0 && (
        <View style={s.bgRow}>
          {bank.availableBloodGroups.slice(0, 6).map(bg => (
            <View key={bg} style={[s.bgChip, { backgroundColor: colors.surface }]}><Text style={[s.bgChipText]}>{bg}</Text></View>
          ))}
          {bank.availableBloodGroups.length > 6 && (
            <Text style={[s.bgMore, { color: colors.muted }]}>+{bank.availableBloodGroups.length - 6}</Text>
          )}
        </View>
      )}

      <TouchableOpacity style={[s.manageBtn, { borderColor: Colors.light.primary }]} onPress={onManage} activeOpacity={0.85}>
        <Text style={s.manageBtnText}>Manage</Text>
        <Ionicons name="arrow-forward" size={16} color={Colors.light.primary} />
      </TouchableOpacity>
    </View>
  );
}

function StatChip({ icon, label, value, color = Colors.light.primary }: {
  icon: string; label: string; value: number; color?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[s.statChip, { backgroundColor: colors.surface }]}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[s.statVal, { color }]}>{value}</Text>
      <Text style={[s.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

// ─── Field ─────────────────────────────────────────────────────────────────────

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={s.backBtn}>
        <Ionicons name="arrow-back" size={24} color={colors.icon} />
      </TouchableOpacity>
      <Text style={[s.headerTitle, { color: colors.text }]}>{title}</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

function Field({ label, value, onChange, multiline, keyboardType, autoCapitalize }: {
  label: string; value: string; onChange: (v: string) => void;
  multiline?: boolean; keyboardType?: any; autoCapitalize?: any;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.fieldWrap}>
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

  section:      { marginBottom: 8 },
  sectionLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Bank card
  bankCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8,
  },
  bankCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  vBadge:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  vBadgeText:     { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },
  bankUpdated:    { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#bbb' },
  bankName:       { fontFamily: 'Poppins_700Bold', fontSize: 17, color: '#222', marginBottom: 2 },
  bankCity:       { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#888', marginBottom: 12 },

  statsRow:  { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statChip:  { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 10, paddingVertical: 8, alignItems: 'center', gap: 2 },
  statVal:   { fontFamily: 'Poppins_700Bold', fontSize: 16, color: Colors.light.primary },
  statLabel: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#888' },

  bgRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  bgChip:    { backgroundColor: '#FDEDEC', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  bgChipText:{ fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: Colors.light.primary },
  bgMore:    { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', alignSelf: 'center' },

  manageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.light.primary, borderRadius: 10,
    paddingVertical: 10, gap: 6,
  },
  manageBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: Colors.light.primary },

  // CTA section
  ctaSection: { marginTop: 4 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 16, marginBottom: 10,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5,
  },
  ctaIcon:  { width: 42, height: 42, borderRadius: 11, backgroundColor: '#F0F4FF', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  ctaTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#222' },
  ctaSub:   { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginTop: 2 },

  // Register / link form
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5,
  },
  cardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#222', marginBottom: 4 },
  cardSub:   { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginBottom: 14 },
  fieldWrap: { marginBottom: 14 },
  fieldLabel:{ fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#555', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#E8E8E8', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#333', backgroundColor: '#FAFAFA',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  searchRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBtn:  { width: 46, height: 46, borderRadius: 10, backgroundColor: Colors.light.primary, justifyContent: 'center', alignItems: 'center' },

  linkCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 14, marginBottom: 10,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5,
  },
  linkName: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#222' },
  linkSub:  { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888' },
  linkBtn:  { backgroundColor: Colors.light.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, marginLeft: 10 },
  linkBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#fff' },

  primaryBtn: {
    backgroundColor: Colors.light.primary, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, borderRadius: 14, marginBottom: 10,
    elevation: 4, shadowColor: Colors.light.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6,
  },
  primaryBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#fff' },
  btnDim: { opacity: 0.6 },
});
