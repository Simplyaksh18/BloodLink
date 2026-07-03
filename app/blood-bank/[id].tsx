import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { bloodBankService, InventoryItem } from '../../services/bloodService';
import { messageService } from '../../services/messageService';
import { BloodBank, BloodGroup } from '../../types';

const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function BloodBankDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();

  const [bank, setBank] = useState<BloodBank | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [selectedBloodGroup, setSelectedBloodGroup] = useState<BloodGroup | ''>('');
  const [units, setUnits] = useState(1);
  const [requestLoading, setRequestLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);

  useEffect(() => {
    if (id) {
      console.log('[BloodBankDiscovery] bankId:', id);
      fetchBankDetails();
    }
  }, [id]);

  const fetchBankDetails = async () => {
    try {
      const [bankRes, invRes] = await Promise.allSettled([
        bloodBankService.getBankById(id as string),
        bloodBankService.getPublicInventory(id as string),
      ]);
      if (bankRes.status === 'fulfilled' && bankRes.value.success && bankRes.value.data) {
        setBank(bankRes.value.data);
      }
      if (invRes.status === 'fulfilled' && invRes.value.success && invRes.value.data) {
        setInventory(invRes.value.data);
      }
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  };

  const handleRequestBlood = async () => {
    if (!selectedBloodGroup) {
      Alert.alert('Select Blood Group', 'Please select the blood group you need.');
      return;
    }
    setRequestLoading(true);
    try {
      const res = await bloodBankService.requestBloodFromBank(id as string, {
        bloodGroup: selectedBloodGroup as BloodGroup,
        unitsRequired: units,
        priority: 'normal',
      });
      if (res.success) {
        console.log('[BloodBankRequest] created for bankId:', id);
        setShowRequestForm(false);
        setSelectedBloodGroup('');
        setUnits(1);
        Alert.alert(
          'Request Submitted',
          'Your blood request has been sent. The blood bank will review it and contact you shortly.'
        );
      } else {
        Alert.alert('Request Failed', res.message || 'Could not submit request. Please try again.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to submit request. Please try again.');
    } finally {
      setRequestLoading(false);
    }
  };

  // Derive selectable blood groups from live inventory or legacy availableBloodGroups
  const displayGroups = useMemo(() => {
    const activeInv = inventory.filter(i => i.status === 'ACTIVE');
    if (activeInv.length > 0) {
      return activeInv.map(i => ({ bloodGroup: i.bloodGroup as BloodGroup, units: i.units, available: i.units > 0 }));
    }
    const legacy = bank?.availableBloodGroups ?? [];
    if (legacy.length > 0) {
      return legacy.map(bg => ({ bloodGroup: bg as BloodGroup, units: null as number | null, available: true }));
    }
    return BLOOD_GROUPS.map(bg => ({ bloodGroup: bg, units: null as number | null, available: true }));
  }, [inventory, bank]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!bank) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.icon} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Blood Bank</Text>
          <View style={{ width: 34 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
          <Text style={[styles.emptyText, { color: colors.muted }]}>Blood bank not found.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
            <Text style={styles.goBackBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>Blood Bank Details</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Bank Name Card */}
        <View style={[styles.bankHeroCard, { backgroundColor: colors.card }]}>
          <View style={styles.bankIconCircle}>
            <Ionicons name="medical" size={32} color="#fff" />
          </View>
          <Text style={[styles.bankName, { color: colors.text }]}>{bank.name}</Text>
          <VerificationBadge status={bank.verificationStatus} isVerified={bank.isVerified} />
        </View>

        {/* Contact Info */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact Information</Text>
          <InfoRow icon="call-outline" label="Phone" value={bank.phone} colors={colors} />
          {bank.email && <InfoRow icon="mail-outline" label="Email" value={bank.email} colors={colors} />}
        </View>

        {/* Location */}
        {bank.location && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Location</Text>
            <InfoRow icon="location-outline" label="Address" value={bank.location.address} colors={colors} />
            <InfoRow
              icon="map-outline"
              label="City"
              value={`${bank.location.city}, ${bank.location.state} - ${bank.location.pincode}`}
              colors={colors}
            />
            {bank.distance !== undefined && (
              <InfoRow icon="navigate-outline" label="Distance" value={`${bank.distance.toFixed(1)} km away`} colors={colors} />
            )}
          </View>
        )}

        {/* Operating Hours */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Operating Hours</Text>
          <View style={styles.hoursRow}>
            <Ionicons name="time-outline" size={18} color={Colors.light.primary} style={{ marginRight: 10 }} />
            <Text style={[styles.hoursText, { color: colors.text }]}>{bank.operatingHours || 'Contact for hours'}</Text>
          </View>
        </View>

        {/* Available Blood Groups */}
        {bank.availableBloodGroups && bank.availableBloodGroups.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Available Blood Groups</Text>
            <View style={styles.bgGrid}>
              {bank.availableBloodGroups.map((bg) => (
                <View key={bg} style={[styles.bgChip, { backgroundColor: colors.surface }]}>
                  <Ionicons name="water" size={16} color={Colors.light.primary} />
                  <Text style={styles.bgChipText}>{bg}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Phase 6 Inventory Summary */}
        {inventory.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Live Inventory</Text>
            <View style={styles.inventoryGrid}>
              {inventory.map(item => (
                <View key={item.id} style={[styles.invChip, item.lowStock && styles.invChipLow]}>
                  <Text style={[styles.invChipBg, { color: colors.text }]}>{item.bloodGroup}</Text>
                  <Text style={[styles.invChipUnits, { color: colors.muted }]}>{item.units} units</Text>
                  {item.lowStock && (
                    <View style={styles.lowBadge}>
                      <Text style={styles.lowBadgeText}>Low</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Request Blood */}
        {!showRequestForm ? (
          <TouchableOpacity style={styles.requestBtn} onPress={() => setShowRequestForm(true)} activeOpacity={0.85}>
            <Ionicons name="water-outline" size={20} color="#fff" style={{ marginRight: 10 }} />
            <Text style={styles.requestBtnText}>Request Blood from this Bank</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.requestForm, { backgroundColor: colors.card }]}>
            <Text style={[styles.formTitle, { color: colors.text }]}>Request Blood</Text>
            <Text style={[styles.formSubtitle, { color: colors.muted }]}>Select blood group and units needed</Text>

            <Text style={[styles.formLabel, { color: colors.text }]}>Blood Group</Text>
            <View style={styles.bgSelector}>
              {displayGroups.map(({ bloodGroup: bg, units: stock, available }) => (
                <TouchableOpacity
                  key={bg}
                  style={[
                    styles.bgOption,
                    selectedBloodGroup === bg && styles.bgOptionSelected,
                    !available && styles.bgOptionDisabled,
                  ]}
                  onPress={() => available ? setSelectedBloodGroup(bg) : undefined}
                  disabled={!available}
                >
                  <Text style={[styles.bgOptionText, selectedBloodGroup === bg && styles.bgOptionTextSelected, !available && { color: '#ccc' }]}>
                    {bg}
                  </Text>
                  {stock !== null && (
                    <Text style={[styles.bgOptionUnits, !available && { color: '#ccc' }]}>
                      {stock > 0 ? `${stock}u` : 'Out'}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.formLabel, { color: colors.text }]}>Units Required</Text>
            <View style={styles.unitRow}>
              <TouchableOpacity
                style={[styles.unitBtn, { backgroundColor: colors.surface }]}
                onPress={() => setUnits((u) => Math.max(1, u - 1))}
              >
                <Ionicons name="remove" size={20} color={Colors.light.primary} />
              </TouchableOpacity>
              <Text style={[styles.unitCount, { color: colors.text }]}>{units}</Text>
              <TouchableOpacity style={styles.unitBtn} onPress={() => setUnits((u) => u + 1)}>
                <Ionicons name="add" size={20} color={Colors.light.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (!selectedBloodGroup || requestLoading) && styles.submitBtnDisabled]}
              onPress={handleRequestBlood}
              disabled={!selectedBloodGroup || requestLoading}
              activeOpacity={0.85}
            >
              {requestLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Request</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelFormBtn} onPress={() => setShowRequestForm(false)}>
              <Text style={styles.cancelFormText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Messaging */}
        <View style={[styles.section, { backgroundColor: colors.card, marginTop: 12 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Direct Messages</Text>
          {bank.ownerId ? (
            <TouchableOpacity
              style={[styles.messageBtn, messageLoading && { opacity: 0.7 }]}
              onPress={async () => {
                console.log('[BankMessage] pressed bankId:', id);
                console.log('[BankMessage] ownerId:', bank.ownerId);
                setMessageLoading(true);
                try {
                  const res = await messageService.createOrGetBankConversation(id as string);
                  if (res.success && res.data) {
                    const { conversationId, bankName } = res.data;
                    console.log('[BankMessage] create/get conversation success:', conversationId);
                    console.log('[BankMessage] navigating conversationId:', conversationId);
                    router.push(
                      `/(modals)/chat?conversationId=${conversationId}&name=${encodeURIComponent(bankName || bank.name)}&role=Bank` as any
                    );
                  }
                } catch (e: any) {
                  const errMsg = e?.response?.data?.message ?? e?.message ?? String(e);
                  console.log('[BankMessage] error:', errMsg);
                  Alert.alert('Error', 'Could not start conversation. Please try again.');
                } finally {
                  setMessageLoading(false);
                }
              }}
              disabled={messageLoading}
              activeOpacity={0.85}
            >
              {messageLoading ? (
                <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
              ) : (
                <Ionicons name="chatbubble-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
              )}
              <Text style={styles.messageBtnText}>{messageLoading ? 'Opening...' : 'Message this Bank'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.unmanagedBox, { backgroundColor: colors.surface ?? colors.background }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.muted} style={{ marginRight: 8 }} />
              <Text style={[styles.unmanagedText, { color: colors.muted }]}>
                This blood bank is not yet managed in BloodLink.
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function VerificationBadge({
  status,
  isVerified,
}: {
  status?: string;
  isVerified?: boolean;
}) {
  const verified = status === 'VERIFIED' || isVerified;
  const rejected = status === 'REJECTED';
  if (!status && !isVerified) return null;

  const bg = verified ? 'rgba(46,204,113,0.1)' : rejected ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)';
  const color = verified ? '#2ECC71' : rejected ? '#E74C3C' : '#F39C12';
  const icon = verified ? 'checkmark-circle' : rejected ? 'close-circle' : 'time-outline';
  const label = verified ? 'Verified' : rejected ? 'Rejected' : 'Pending Review';

  return (
    <View style={[styles.verifiedBadge, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[styles.verifiedText, { color }]}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value, colors }: { icon: any; label: string; value: string; colors: any }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={Colors.light.primary} style={styles.infoIcon} />
      <View style={styles.infoContent}>
        <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: { padding: 5 },
  headerTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 17,
    color: '#333',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 10,
  },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  bankHeroCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  bankIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    elevation: 4,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  bankName: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: '#222',
    textAlign: 'center',
    marginBottom: 8,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  verifiedText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#2ECC71',
    marginLeft: 4,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  sectionTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#222',
    marginBottom: 14,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  infoIcon: { marginRight: 12, marginTop: 2 },
  infoContent: { flex: 1 },
  infoLabel: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888' },
  infoValue: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#333', marginTop: 1 },
  hoursRow: { flexDirection: 'row', alignItems: 'center' },
  hoursText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#333', flex: 1 },
  bgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bgChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDEDEC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  bgChipText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: Colors.light.primary, marginLeft: 4 },
  requestBtn: {
    backgroundColor: Colors.light.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 16,
    elevation: 4,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  requestBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#fff' },
  requestForm: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  formTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#222', marginBottom: 4 },
  formSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#666', marginBottom: 20 },
  formLabel: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#555', marginBottom: 10 },
  bgSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  bgOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    backgroundColor: '#FAFAFA',
  },
  bgOptionSelected: { borderColor: Colors.light.primary, backgroundColor: '#FDEDEC' },
  bgOptionDisabled: { borderColor: '#E8E8E8', backgroundColor: '#F8F8F8', opacity: 0.6 },
  bgOptionText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#666' },
  bgOptionTextSelected: { color: Colors.light.primary },
  bgOptionUnits: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#999', marginTop: 1 },
  unitRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  unitBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unitCount: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#333', marginHorizontal: 20 },
  submitBtn: {
    backgroundColor: Colors.light.primary,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 3,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#fff' },
  cancelFormBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelFormText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#999' },
  inventoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  invChip: {
    backgroundColor: '#F0FFF4',
    borderWidth: 1,
    borderColor: '#C3F0CA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 70,
  },
  invChipLow: { backgroundColor: '#FFF5F5', borderColor: '#FEB2B2' },
  invChipBg: { fontFamily: 'Poppins_700Bold', fontSize: 14, color: '#222' },
  invChipUnits: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#666' },
  lowBadge: {
    marginTop: 3,
    backgroundColor: '#FC8181',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lowBadgeText: { fontFamily: 'Poppins_600SemiBold', fontSize: 9, color: '#fff' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { fontFamily: 'Poppins_500Medium', fontSize: 16, color: '#999', marginTop: 12 },
  goBackBtn: {
    marginTop: 20,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#fff' },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2980B9',
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  messageBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#fff' },
  unmanagedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  unmanagedText: { fontFamily: 'Poppins_400Regular', fontSize: 13, lineHeight: 19, flex: 1 },
});
