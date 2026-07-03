import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../context/ThemeContext';
import { Colors } from '../../constants/Colors';
import {
  bloodBankService, BankWithStats, BankRequest, InventoryItem,
} from '../../services/bloodService';
import { notificationService } from '../../services/notificationService';
import { authService } from '../../services/authService';

const EMOJI_OPTIONS = ['🏥', '💉', '🩸', '❤️', '🧬', '🩺', '💊', '🏨', '👨‍⚕️', '👩‍⚕️', '🚑', '⚕️'];

export default function BloodBankDashboard() {
  const router = useRouter();
  const { colors, isDark, toggleTheme } = useTheme();
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(state => state.setUser);

  const [loading, setLoading] = useState(true);
  const [bankStats, setBankStats] = useState<BankWithStats | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [fulfilledCount, setFulfilledCount] = useState(0);
  const [inventoryUnits, setInventoryUnits] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [savingEmoji, setSavingEmoji] = useState(false);

  const displayEmoji = user?.profileEmoji ?? '🏥';

  const handlePickEmoji = async (emoji: string) => {
    setShowEmojiPicker(false);
    setSavingEmoji(true);
    try {
      const res = await authService.updateEmoji(emoji);
      if (res.success && res.data) setUser(res.data);
    } catch {
      Alert.alert('Error', 'Could not save emoji.');
    } finally {
      setSavingEmoji(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        setLoading(true);
        console.log('[BloodBankDashboard] loaded');
        try {
          const [banksRes, reqsRes, invRes, notifRes] = await Promise.allSettled([
            bloodBankService.getMyBanks(),
            bloodBankService.getMyBankRequests(),
            bloodBankService.getMyInventory(),
            notificationService.getUnreadCount(),
          ]);

          if (!active) return;

          if (banksRes.status === 'fulfilled' && banksRes.value.success && banksRes.value.data?.length) {
            const bank = banksRes.value.data[0];
            setBankStats(bank);
          }

          if (reqsRes.status === 'fulfilled' && reqsRes.value.success) {
            const reqs: BankRequest[] = reqsRes.value.data ?? [];
            const pending = reqs.filter(r => r.status === 'OPEN' || r.status === 'ACTIVE').length;
            const fulfilled = reqs.filter(r => r.status === 'FULFILLED' || r.status === 'COMPLETED').length;
            setPendingCount(pending);
            setFulfilledCount(fulfilled);
            const subtitle = pending === 1 ? '1 pending request' : pending > 1 ? `${pending} pending requests` : 'No pending requests';
            console.log('[BloodBankDashboard] raw requests count:', reqs.length);
            console.log('[BloodBankDashboard] pending requests count:', pending);
            console.log('[BloodBankDashboard] request center subtitle:', subtitle);
          }

          if (invRes.status === 'fulfilled' && invRes.value.success) {
            const items: InventoryItem[] = invRes.value.data ?? [];
            const totalUnits = items.reduce((s, i) => s + (i.units ?? 0), 0);
            const lowStock = items.filter(i => i.lowStock).length;
            const expiring = items.filter(i => i.expiringSoon).length;
            setInventoryUnits(totalUnits);
            setLowStockCount(lowStock);
            setExpiringSoonCount(expiring);
            console.log('[BloodBankDashboard] inventory:', totalUnits);
          }

          if (notifRes.status === 'fulfilled') {
            const count = (notifRes.value as any)?.data?.count ?? 0;
            setUnreadCount(count);
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
  const bid = bankStats?.id;

  const gridCards = [
    {
      id: 'inventory',
      icon: 'flask' as const,
      iconBg: '#FDEDEC',
      iconColor: Colors.light.primary,
      title: 'Manage Inventory',
      sub: inventoryUnits > 0 ? `${inventoryUnits} units available` : 'No units logged',
      badge: lowStockCount > 0 ? `${lowStockCount} low` : undefined,
      badgeColor: '#E67E22',
      route: bid ? `/blood-bank/inventory?bankId=${bid}` : '/blood-bank/my-bank',
    },
    {
      id: 'requests',
      icon: 'document-text' as const,
      iconBg: '#EBF5FB',
      iconColor: '#2980B9',
      title: 'Request Center',
      sub: pendingCount === 1 ? '1 pending request' : pendingCount > 1 ? `${pendingCount} pending requests` : 'No pending requests',
      badge: pendingCount > 0 ? String(pendingCount) : undefined,
      badgeColor: Colors.light.primary,
      route: bid ? `/blood-bank/bank-manage?bankId=${bid}` : '/blood-bank/my-bank',
    },
    {
      id: 'messages',
      icon: 'chatbubbles' as const,
      iconBg: '#EAFAF1',
      iconColor: '#27AE60',
      title: 'Bank Messages',
      sub: 'Coordinate with requesters',
      badge: undefined,
      badgeColor: undefined,
      route: '/(tabs)/inbox',
    },
    {
      id: 'profile',
      icon: 'person-circle' as const,
      iconBg: '#F5EEF8',
      iconColor: '#8E44AD',
      title: 'Bank Profile',
      sub: hasBank ? 'View & edit details' : 'Set up your bank',
      badge: hasBank && !bankStats!.isVerified ? '!' : undefined,
      badgeColor: '#E67E22',
      route: '/(tabs)/profile',
    },
    {
      id: 'link',
      icon: 'add-circle' as const,
      iconBg: '#FEF9E7',
      iconColor: '#F39C12',
      title: 'Add / Link Bank',
      sub: hasBank ? 'Manage linked banks' : 'Register your blood bank',
      badge: undefined,
      badgeColor: undefined,
      route: '/blood-bank/my-bank',
    },
    {
      id: 'analytics',
      icon: 'bar-chart' as const,
      iconBg: '#EBF5FB',
      iconColor: '#1A5276',
      title: 'Activity Log',
      sub: fulfilledCount > 0 ? `${fulfilledCount} fulfilled · events` : 'View all activity',
      badge: undefined,
      badgeColor: undefined,
      route: bid ? `/blood-bank/activity?bankId=${bid}` : '/blood-bank/my-bank',
    },
  ];

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
                <TouchableOpacity
                  style={[styles.emojiOption, { backgroundColor: colors.background }]}
                  onPress={() => handlePickEmoji(item)}
                >
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
          <View style={styles.logoIconCircle}>
            <Ionicons name="water" size={22} color={Colors.light.primary} />
          </View>
          <View>
            <Text style={[styles.logoText, { color: colors.text }]}>BloodLink</Text>
            <Text style={[styles.logoSub, { color: colors.muted }]}>Bank Console</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setShowEmojiPicker(true)}
            disabled={savingEmoji}
          >
            <Text style={styles.emojiAvatarText}>{displayEmoji}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} onPress={toggleTheme}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerIconBtn, { position: 'relative' }]}
            onPress={() => { setUnreadCount(0); router.push('/(modals)/notifications' as any); }}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.icon} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Bank identity / stats card */}
        {loading ? (
          <View style={[styles.identityCard, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', paddingVertical: 32 }]}>
            <ActivityIndicator color={Colors.light.primary} />
          </View>
        ) : hasBank ? (
          <View style={[styles.identityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.identityTop}>
              <View style={[styles.bankIconCircle, { backgroundColor: colors.surface ?? colors.background }]}>
                <Ionicons name="medical" size={28} color={Colors.light.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.bankName, { color: colors.text }]} numberOfLines={2}>
                  {bankStats!.name}
                </Text>
                <View style={[styles.verifiedChip, bankStats!.isVerified ? styles.verifiedGreen : styles.verifiedOrange]}>
                  <Ionicons
                    name={bankStats!.isVerified ? 'shield-checkmark' : 'time-outline'}
                    size={11}
                    color="#fff"
                  />
                  <Text style={styles.verifiedChipText}>
                    {bankStats!.isVerified ? 'Verified' : 'Pending Verification'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
              <View style={styles.statCell}>
                <Text style={[styles.statNum, { color: Colors.light.primary }]}>
                  {inventoryUnits > 0 ? inventoryUnits : (bankStats!.inventoryUnits ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Units</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statCell}>
                <Text style={[styles.statNum, { color: '#E67E22' }]}>
                  {pendingCount || (bankStats!.pendingRequests ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Pending</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statCell}>
                <Text style={[styles.statNum, { color: '#27AE60' }]}>
                  {fulfilledCount || (bankStats!.fulfilledRequests ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Fulfilled</Text>
              </View>
              {lowStockCount > 0 && (
                <>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statCell}>
                    <Text style={[styles.statNum, { color: '#E74C3C' }]}>{lowStockCount}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>Low Stock</Text>
                  </View>
                </>
              )}
              {expiringSoonCount > 0 && (
                <>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statCell}>
                    <Text style={[styles.statNum, { color: '#F39C12' }]}>{expiringSoonCount}</Text>
                    <Text style={[styles.statLabel, { color: colors.muted }]}>Expiring</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.identityCard, styles.setupCard, { backgroundColor: colors.card, borderColor: Colors.light.primary }]}
            onPress={() => router.push('/blood-bank/my-bank' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={36} color={Colors.light.primary} />
            <Text style={[styles.setupTitle, { color: Colors.light.primary }]}>Set Up Your Blood Bank</Text>
            <Text style={[styles.setupSub, { color: colors.muted }]}>
              Register your bank to manage inventory and incoming requests
            </Text>
          </TouchableOpacity>
        )}

        {/* Operations grid */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>

        <View style={styles.grid}>
          {gridCards.map(card => {
            console.log('[BloodBankDashboard] rendering card:', card.title);
            return (
            <TouchableOpacity
              key={card.id}
              style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {
                console.log('[BloodBankDashboard] card pressed:', card.title);
                console.log('[BankRoute] navigating:', card.route);
                router.push(card.route as any);
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.gridIconBox, { backgroundColor: card.iconBg }]}>
                <Ionicons name={card.icon} size={24} color={card.iconColor} />
              </View>
              {card.badge && (
                <View style={[styles.gridBadge, { backgroundColor: card.badgeColor }]}>
                  <Text style={styles.gridBadgeText}>{card.badge}</Text>
                </View>
              )}
              <Text style={[styles.gridCardTitle, { color: colors.text }]}>{card.title}</Text>
              <Text style={[styles.gridCardSub, { color: colors.muted }]} numberOfLines={2}>
                {card.sub}
              </Text>
            </TouchableOpacity>
          );
          })}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: { fontFamily: 'Poppins_700Bold', fontSize: 20, lineHeight: 24 },
  logoSub: { fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 14 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiAvatarText: { fontSize: 20 },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: Colors.light.primary,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  notifBadgeText: { color: '#fff', fontSize: 9, fontFamily: 'Poppins_700Bold' },

  // Emoji picker
  emojiOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiSheet: { borderRadius: 20, padding: 20, width: 280 },
  emojiSheetTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  emojiOption: {
    flex: 1,
    margin: 6,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiOptionText: { fontSize: 28 },

  scrollContent: { paddingBottom: 48, paddingTop: 4 },

  // Identity card
  identityCard: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  identityTop: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  bankIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankName: { fontFamily: 'Poppins_700Bold', fontSize: 16, lineHeight: 22, marginBottom: 6 },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  verifiedGreen: { backgroundColor: '#27AE60' },
  verifiedOrange: { backgroundColor: '#E67E22' },
  verifiedChipText: { color: '#fff', fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, marginVertical: 4 },
  statNum: { fontFamily: 'Poppins_700Bold', fontSize: 20 },
  statLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, marginTop: 2 },
  setupCard: { alignItems: 'center', padding: 28, borderStyle: 'dashed', gap: 10 },
  setupTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16 },
  setupSub: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Grid
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 17,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  gridCard: {
    width: '46.5%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    position: 'relative',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  gridIconBox: {
    width: 50,
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  gridBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Poppins_700Bold' },
  gridCardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, lineHeight: 18 },
  gridCardSub: { fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 16 },
});
