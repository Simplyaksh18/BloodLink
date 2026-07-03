import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { notificationService, AppNotification } from '../../services/notificationService';
import { timeAgo } from '../../utils/timeAgo';

console.log('[TimeFormat] using shared formatter');

function notifIcon(type: string): React.ComponentProps<typeof Ionicons>['name'] {
  switch (type) {
    case 'REQUEST_MATCHED':              return 'water-outline';
    case 'DONOR_ACCEPTED':              return 'checkmark-circle-outline';
    case 'REQUEST_CANCELLED':           return 'close-circle-outline';
    case 'REQUEST_FULFILLED':           return 'heart-outline';
    case 'REQUEST_EXPIRED':             return 'time-outline';
    case 'DONATION_PROOF_SUBMITTED':    return 'document-attach-outline';
    case 'BLOOD_BANK_REQUEST_NEW':      return 'business-outline';
    case 'BLOOD_BANK_REQUEST_ACCEPTED': return 'checkmark-done-outline';
    case 'BLOOD_BANK_REQUEST_REJECTED': return 'close-circle-outline';
    case 'BLOOD_BANK_REQUEST_FULFILLED':return 'bag-check-outline';
    default:                            return 'notifications-outline';
  }
}

function notifTargetRoute(notif: AppNotification): string | null {
  const type = notif.type ?? '';
  // Blood bank notifications: use bankId from data if available, else parent screen
  if (type.startsWith('BLOOD_BANK')) {
    const bankId = notif.data?.bloodBankId as string | undefined;
    return bankId ? `/blood-bank/bank-manage?bankId=${bankId}` : '/blood-bank/my-bank';
  }
  // Message notifications: navigate to inbox (chat requires name/role params not available here)
  if (type === 'NEW_MESSAGE') {
    return '/(tabs)/inbox';
  }
  // Request-related notifications: navigate to Activity tab
  if (
    type === 'DONOR_ACCEPTED' ||
    type === 'DONATION_PROOF_SUBMITTED' ||
    type === 'REQUEST_FULFILLED' ||
    type === 'REQUEST_CANCELLED' ||
    type === 'REQUEST_EXPIRED' ||
    type === 'REQUEST_MATCHED' ||
    notif.relatedRequestId
  ) {
    return '/(tabs)/request';
  }
  return null;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  console.log('[Theme] notification screen applied');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      console.log('[NotificationUI] fetching notifications');
      setLoading(true);

      notificationService.getNotifications(1, 50)
        .then((res) => {
          if (!active) return;
          const items = res?.data?.data ?? [];
          console.log('[NotificationUI] notification count:', items.length);
          setNotifications(items);

          // Mark all read silently after loading so badge clears
          if (items.some(n => !n.isRead)) {
            notificationService.markAllRead().catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

      return () => { active = false; };
    }, [])
  );

  const handleTapNotification = (notif: AppNotification) => {
    if (!notif.isRead) {
      notificationService.markRead(notif.id).catch(() => {});
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n)
      );
    }
    console.log('[NotificationTap] raw notification:', JSON.stringify({ id: notif.id, type: notif.type, relatedRequestId: notif.relatedRequestId, data: notif.data }));
    console.log('[NotificationTap] type:', notif.type ?? '(none)');
    console.log('[NotificationTap] data:', JSON.stringify(notif.data ?? {}));
    const target = notifTargetRoute(notif);
    console.log('[NotificationTap] resolved route:', target ?? '(no route)');
    if (target) {
      console.log('[NotificationTap] navigating:', target);
      try {
        router.push(target as any);
        console.log('[NotificationTap] navigation success:', target);
      } catch (err: any) {
        console.log('[NotificationTap] navigation failed:', err?.message ?? err);
      }
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.iconCircle}>
                <Ionicons name="notifications-off-outline" size={60} color={Colors.light.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>You're All Caught Up!</Text>
              <Text style={[styles.emptyDesc, { color: colors.muted }]}>
                No new notifications right now. We'll let you know when there's an emergency blood request near you.
              </Text>
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.replace('/(tabs)')}>
                <Text style={styles.actionBtnText}>Go to Dashboard</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Notifications</Text>
              {notifications.map((notif) => (
                <TouchableOpacity
                  key={notif.id}
                  style={[
                    styles.notifCard,
                    { backgroundColor: colors.card },
                    !notif.isRead && styles.notifCardUnread,
                    !notif.isRead && { backgroundColor: colors.surface },
                  ]}
                  onPress={() => handleTapNotification(notif)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.notifIconBox, !notif.isRead && styles.notifIconBoxUnread]}>
                    <Ionicons name={notifIcon(notif.type)} size={24} color={Colors.light.primary} />
                  </View>
                  <View style={styles.notifTextContainer}>
                    <Text style={[styles.notifTitle, { color: colors.text }]}>{notif.title}</Text>
                    <Text style={[styles.notifBody, { color: colors.muted }]}>{notif.body}</Text>
                    <Text style={[styles.notifTime, { color: colors.muted }]}>{timeAgo(notif.createdAt)}</Text>
                  </View>
                  {!notif.isRead && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
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
    fontSize: 18,
    color: '#333',
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 10,
    marginTop: 60,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#333',
    marginBottom: 10,
  },
  emptyDesc: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
  },
  actionBtn: {
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 12,
    elevation: 3,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  actionBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#fff',
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#333',
    marginBottom: 12,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  notifCardUnread: {
    backgroundColor: '#FFF8F8',
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.primary,
  },
  notifIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  notifIconBoxUnread: {
    backgroundColor: 'rgba(231, 76, 60, 0.18)',
  },
  notifTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  notifTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#333',
  },
  notifBody: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#666',
    marginTop: 2,
    lineHeight: 18,
  },
  notifTime: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: '#999',
    marginTop: 6,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.light.primary,
    marginLeft: 10,
  },
});
