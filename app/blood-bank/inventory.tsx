import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { bloodBankService, InventoryItem } from '../../services/bloodService';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function InventoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bankId } = useLocalSearchParams<{ bankId?: string }>();
  const { colors } = useTheme();
  useEffect(() => {
    console.log('[BankTheme] screen: inventory');
    console.log('[BankRoute] received params: bankId=', bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [items, setItems]         = useState<InventoryItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showAdd, setShowAdd]     = useState(false);
  const [editItem, setEditItem]   = useState<InventoryItem | null>(null);
  const [deleting, setDeleting]   = useState<string | null>(null);

  const [addBg, setAddBg]         = useState('');
  const [addUnits, setAddUnits]   = useState('');
  const [addExpiry, setAddExpiry] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const [editUnits, setEditUnits]   = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await bloodBankService.getMyInventory(bankId);
      if (res.success && res.data) {
        console.log('[BloodBankUI] inventory count:', res.data.length);
        setItems(res.data);
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        Alert.alert('No Blood Bank', 'Please register your blood bank first.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  // ─── Add ────────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addBg) { Alert.alert('Select blood group'); return; }
    const units = parseInt(addUnits, 10);
    if (isNaN(units) || units < 0) { Alert.alert('Enter valid units (0 or more)'); return; }
    setAddSaving(true);
    try {
      const res = await bloodBankService.addInventory({ bloodGroup: addBg, units, expiryDate: addExpiry.trim() || undefined }, bankId);
      if (res.success && res.data) {
        setItems(prev => [res.data!, ...prev]);
        setShowAdd(false);
        resetAddForm();
      } else {
        Alert.alert('Failed', res.message ?? 'Could not add item.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to add item.');
    } finally {
      setAddSaving(false);
    }
  };

  function resetAddForm() { setAddBg(''); setAddUnits(''); setAddExpiry(''); }

  // ─── Edit ───────────────────────────────────────────────────────────────────

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setEditUnits(String(item.units));
    setEditExpiry(item.expiryDate ? item.expiryDate.split('T')[0] : '');
  };

  const handleEdit = async () => {
    if (!editItem) return;
    const units = parseInt(editUnits, 10);
    if (isNaN(units) || units < 0) { Alert.alert('Enter valid units'); return; }
    setEditSaving(true);
    try {
      const res = await bloodBankService.updateInventory(editItem.id, { units, expiryDate: editExpiry.trim() || null }, bankId);
      if (res.success && res.data) {
        setItems(prev => prev.map(i => i.id === editItem.id ? res.data! : i));
        setEditItem(null);
      } else {
        Alert.alert('Failed', res.message ?? 'Could not update.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update.');
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = (item: InventoryItem) => {
    Alert.alert('Delete Item', `Remove ${item.bloodGroup} (${item.units} units) from inventory?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(item.id);
          try {
            await bloodBankService.deleteInventory(item.id, bankId);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message ?? 'Failed to delete.');
          } finally {
            setDeleting(null);
          }
        },
      },
    ]);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const lowCount      = items.filter(i => i.lowStock && i.status === 'ACTIVE').length;
  const expiringCount = items.filter(i => i.expiringSoon && i.status === 'ACTIVE').length;
  const q             = search.trim().toLowerCase();
  const filtered      = q ? items.filter(i => i.bloodGroup.toLowerCase().includes(q)) : items;
  const available     = filtered.filter(i => i.status === 'ACTIVE' && i.units > 0 && !i.lowStock);
  const lowStock      = filtered.filter(i => i.status === 'ACTIVE' && i.lowStock && i.units > 0);
  const expiring      = filtered.filter(i => i.expiringSoon && i.status === 'ACTIVE');
  const outOfStock    = filtered.filter(i => i.units === 0 || i.status !== 'ACTIVE');

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Inventory</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={s.iconBtn}>
          <Ionicons name="add" size={24} color={Colors.light.primary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[s.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={[s.searchInput, { color: colors.inputText }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search blood group…"
          placeholderTextColor={colors.inputPlaceholder}
          autoCapitalize="characters"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {lowCount > 0 && (
            <View style={[s.alertBanner, { backgroundColor: '#FFF5F5', borderColor: '#FEB2B2' }]}>
              <Ionicons name="warning-outline" size={18} color="#E74C3C" />
              <Text style={[s.alertText, { color: '#E74C3C' }]}>{lowCount} item{lowCount > 1 ? 's' : ''} running low on stock</Text>
            </View>
          )}
          {expiringCount > 0 && (
            <View style={[s.alertBanner, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' }]}>
              <Ionicons name="time-outline" size={18} color="#D97706" />
              <Text style={[s.alertText, { color: '#D97706' }]}>{expiringCount} item{expiringCount > 1 ? 's' : ''} expiring within 7 days</Text>
            </View>
          )}

          {filtered.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>🩸</Text>
              <Text style={[s.emptyTitle, { color: colors.text }]}>{items.length === 0 ? 'No Inventory' : 'No Results'}</Text>
              <Text style={[s.emptySub, { color: colors.muted }]}>{items.length === 0 ? 'Tap + to add blood group stock' : 'Try a different search term'}</Text>
            </View>
          ) : (
            <>
              <InventorySection title="Available" items={available} onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
              <InventorySection title="Low Stock" items={lowStock} color="#E74C3C" onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
              <InventorySection title="Expiring Soon" items={expiring} color="#D97706" onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
              <InventorySection title="Out of Stock / Inactive" items={outOfStock} color="#95A5A6" onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Add Modal */}
      <Modal visible={showAdd} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom + 12, 24) }]}>
              <View style={[s.modalHandle, { backgroundColor: colors.border }]} />
              <Text style={[s.modalTitle, { color: colors.text }]}>Add Inventory</Text>

              <Text style={[s.label, { color: colors.muted }]}>Blood Group</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={s.bgRow}>
                  {BLOOD_GROUPS.map(bg => (
                    <TouchableOpacity
                      key={bg}
                      style={[s.bgChip, { borderColor: addBg === bg ? Colors.light.primary : colors.border, backgroundColor: addBg === bg ? '#FDEDEC' : colors.surface }]}
                      onPress={() => setAddBg(bg)}
                    >
                      <Text style={[s.bgChipText, { color: addBg === bg ? Colors.light.primary : colors.muted }]}>{bg}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={[s.label, { color: colors.muted }]}>Units</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                value={addUnits} onChangeText={setAddUnits}
                placeholder="e.g. 10" placeholderTextColor={colors.inputPlaceholder} keyboardType="number-pad"
              />

              <Text style={[s.label, { color: colors.muted }]}>Expiry Date (YYYY-MM-DD, optional)</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                value={addExpiry} onChangeText={setAddExpiry}
                placeholder="2026-12-31" placeholderTextColor={colors.inputPlaceholder}
              />

              <View style={s.modalActions}>
                <TouchableOpacity style={[s.btnOutline, { borderColor: Colors.light.primary }]} onPress={() => { setShowAdd(false); resetAddForm(); }}>
                  <Text style={[s.btnOutlineText, { color: Colors.light.primary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, addSaving && s.btnDisabled]} onPress={handleAdd} disabled={addSaving}>
                  {addSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Add</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={!!editItem} animationType="slide" transparent statusBarTranslucent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom + 12, 24) }]}>
              <View style={[s.modalHandle, { backgroundColor: colors.border }]} />
              <Text style={[s.modalTitle, { color: colors.text }]}>Edit — {editItem?.bloodGroup}</Text>

              <Text style={[s.label, { color: colors.muted }]}>Units</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                value={editUnits} onChangeText={setEditUnits}
                keyboardType="number-pad" placeholderTextColor={colors.inputPlaceholder}
              />

              <Text style={[s.label, { color: colors.muted }]}>Expiry Date (YYYY-MM-DD)</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                value={editExpiry} onChangeText={setEditExpiry}
                placeholder="Leave blank to clear" placeholderTextColor={colors.inputPlaceholder}
              />

              <View style={s.modalActions}>
                <TouchableOpacity style={[s.btnOutline, { borderColor: Colors.light.primary }]} onPress={() => setEditItem(null)}>
                  <Text style={[s.btnOutlineText, { color: Colors.light.primary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, editSaving && s.btnDisabled]} onPress={handleEdit} disabled={editSaving}>
                  {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── InventorySection ──────────────────────────────────────────────────────────

function InventorySection({
  title, items, color = Colors.light.primary, onEdit, onDelete, deleting,
}: {
  title: string; items: InventoryItem[]; color?: string;
  onEdit: (i: InventoryItem) => void; onDelete: (i: InventoryItem) => void; deleting: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <Text style={[s.sectionLabel, { color }]}>{title} ({items.length})</Text>
      {items.map(item => (
        <InventoryRow key={item.id} item={item} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} deleting={deleting === item.id} />
      ))}
    </>
  );
}

// ─── InventoryRow ──────────────────────────────────────────────────────────────

function InventoryRow({
  item, onEdit, onDelete, deleting,
}: {
  item: InventoryItem; onEdit: () => void; onDelete: () => void; deleting: boolean;
}) {
  const { colors } = useTheme();
  const expDisplay = item.expiryDate ? item.expiryDate.split('T')[0] : null;

  return (
    <View style={[s.row, item.status !== 'ACTIVE' && s.rowInactive, { backgroundColor: colors.card }]}>
      <View style={[s.bgBadge, item.lowStock && s.bgBadgeLow]}>
        <Text style={s.bgBadgeText}>{item.bloodGroup}</Text>
      </View>

      <View style={s.rowInfo}>
        <View style={s.rowTopLine}>
          <Text style={[s.rowUnits, { color: colors.text }]}>{item.units} units</Text>
          {item.status !== 'ACTIVE' && (
            <View style={[s.statusPill, { backgroundColor: colors.surface }]}>
              <Text style={[s.statusPillText, { color: colors.muted }]}>{item.status}</Text>
            </View>
          )}
        </View>
        {expDisplay && (
          <Text style={[s.rowExpiry, item.expiringSoon && s.rowExpiryWarn, (item as any).expired && s.rowExpiryExp]}>
            Expires: {expDisplay}
            {(item as any).expired ? ' (Expired)' : item.expiringSoon ? ' (Soon)' : ''}
          </Text>
        )}
        {item.lowStock && item.status === 'ACTIVE' && (
          <Text style={s.lowLabel}>⚠ Low stock</Text>
        )}
      </View>

      <View style={s.rowActions}>
        <TouchableOpacity onPress={onEdit} style={s.actionBtn}>
          <Ionicons name="create-outline" size={20} color={colors.icon} />
        </TouchableOpacity>
        {deleting ? (
          <ActivityIndicator size="small" color="#E74C3C" style={s.actionBtn} />
        ) : (
          <TouchableOpacity onPress={onDelete} style={s.actionBtn}>
            <Ionicons name="trash-outline" size={20} color="#E74C3C" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:   { flex: 1 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1 },
  iconBtn:     { padding: 5 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, flex: 1, textAlign: 'center', marginHorizontal: 10 },
  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5 },
  searchInput: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 14 },
  sectionLabel:{ fontFamily: 'Poppins_600SemiBold', fontSize: 12, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  scroll:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  alertBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10, gap: 8 },
  alertText:   { fontFamily: 'Poppins_500Medium', fontSize: 13, flex: 1 },
  emptyWrap:   { alignItems: 'center', marginTop: 60 },
  emptyIcon:   { fontSize: 48, marginBottom: 12 },
  emptyTitle:  { fontFamily: 'Poppins_600SemiBold', fontSize: 18 },
  emptySub:    { fontFamily: 'Poppins_400Regular', fontSize: 14, marginTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 10,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  rowInactive:    { opacity: 0.6 },
  bgBadge:        { width: 56, height: 56, borderRadius: 12, backgroundColor: '#FEF3F2', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  bgBadgeLow:     { backgroundColor: '#FFF1F1', borderWidth: 1.5, borderColor: '#FEB2B2' },
  bgBadgeText:    { fontFamily: 'Poppins_700Bold', fontSize: 16, color: Colors.light.primary },
  rowInfo:        { flex: 1 },
  rowTopLine:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowUnits:       { fontFamily: 'Poppins_600SemiBold', fontSize: 15 },
  statusPill:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontFamily: 'Poppins_500Medium', fontSize: 11 },
  rowExpiry:      { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#888', marginTop: 2 },
  rowExpiryWarn:  { color: '#D97706' },
  rowExpiryExp:   { color: '#E74C3C' },
  lowLabel:       { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#E74C3C', marginTop: 2 },
  rowActions:     { flexDirection: 'row', gap: 4 },
  actionBtn:      { padding: 8 },
  modalOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 16 },
  modalHandle:    { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle:     { fontFamily: 'Poppins_700Bold', fontSize: 18, marginBottom: 16 },
  label:          { fontFamily: 'Poppins_500Medium', fontSize: 13, marginBottom: 8 },
  input:          { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontFamily: 'Poppins_400Regular', fontSize: 14, marginBottom: 16 },
  bgRow:          { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  bgChip:         { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  bgChipText:     { fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  modalActions:   { flexDirection: 'row', gap: 12, marginTop: 4 },
  btn: {
    flex: 1, backgroundColor: Colors.light.primary, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, elevation: 3,
    shadowColor: Colors.light.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 5,
  },
  btnDisabled:    { opacity: 0.6 },
  btnText:        { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#fff' },
  btnOutline:     { flex: 1, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
  btnOutlineText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15 },
});
