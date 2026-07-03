import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { bloodBankService, BankRequest } from '../../services/bloodService';

// ─── Event model ──────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  icon: string;
  iconColor: string;
  iconBg: string;
}

function deriveEvents(requests: BankRequest[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const req of requests) {
    if (req.status === 'FULFILLED') {
      events.push({
        id: `fulfilled-${req.id}`,
        title: 'Blood supplied',
        subtitle: `${req.bloodGroup} · ${req.units}u · to ${req.requester.name}`,
        date: req.updatedAt,
        icon: 'checkmark-circle',
        iconColor: '#27AE60',
        iconBg: '#EAFAF1',
      });
    } else if (req.status === 'IN_PROGRESS') {
      events.push({
        id: `inprogress-${req.id}`,
        title: 'Request accepted',
        subtitle: `${req.bloodGroup} · ${req.units}u · from ${req.requester.name}`,
        date: req.updatedAt,
        icon: 'time',
        iconColor: '#E67E22',
        iconBg: '#FEF3E2',
      });
    } else if (req.status === 'CANCELLED') {
      events.push({
        id: `declined-${req.id}`,
        title: 'Request declined',
        subtitle: `${req.bloodGroup} · ${req.units}u · from ${req.requester.name}`,
        date: req.updatedAt,
        icon: 'close-circle',
        iconColor: '#E74C3C',
        iconBg: '#FDEDEC',
      });
    } else if (req.status === 'OPEN' || req.status === 'ACTIVE') {
      events.push({
        id: `new-${req.id}`,
        title: 'New request received',
        subtitle: `${req.bloodGroup} · ${req.units}u · from ${req.requester.name}`,
        date: req.createdAt,
        icon: 'document-text',
        iconColor: '#2980B9',
        iconBg: '#EBF5FB',
      });
    }
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events.slice(0, 60);
}

function relativeTime(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)  return `${diffDay}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActivityScreen() {
  const router   = useRouter();
  const { colors } = useTheme();
  const { bankId } = useLocalSearchParams<{ bankId?: string }>();
  console.log('[BankTheme] screen: activity');
  console.log('[BankRoute] received params: bankId=', bankId);

  const [loading, setLoading]     = useState(true);
  const [events, setEvents]       = useState<ActivityEvent[]>([]);
  const [fetchError, setFetchError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!bankId) { setLoading(false); return; }
      let active = true;
      const load = async () => {
        setFetchError(false);
        setLoading(true);
        try {
          const res = await bloodBankService.getMyBankRequests(bankId);
          if (!active) return;
          const reqs: BankRequest[] = (res.success && res.data) ? res.data : [];
          const derived = deriveEvents(reqs);
          console.log('[BankActivity] derived count:', derived.length);
          setEvents(derived);
        } catch (e) {
          console.error('[BankActivity] fetch error:', e);
          setFetchError(true);
        } finally {
          if (active) setLoading(false);
        }
      };
      load();
      return () => { active = false; };
    }, [bankId])
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.text }]}>Recent Activity</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : fetchError ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.muted} />
          <Text style={[s.stateTitle, { color: colors.muted }]}>Could not load activity</Text>
          <Text style={[s.stateSub, { color: colors.muted }]}>Check your connection and try again.</Text>
        </View>
      ) : !bankId ? (
        <View style={s.center}>
          <Ionicons name="business-outline" size={52} color={colors.muted} />
          <Text style={[s.stateTitle, { color: colors.muted }]}>No bank selected</Text>
        </View>
      ) : events.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="time-outline" size={56} color={colors.border} />
          <Text style={[s.stateTitle, { color: colors.text }]}>No Activity Yet</Text>
          <Text style={[s.stateSub, { color: colors.muted }]}>
            Activity will appear here as you manage requests and inventory.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[s.hint, { color: colors.muted }]}>Derived from your request history</Text>
          {events.map(event => (
            <View key={event.id} style={[s.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[s.eventIcon, { backgroundColor: event.iconBg }]}>
                <Ionicons name={event.icon as any} size={20} color={event.iconColor} />
              </View>
              <View style={s.eventBody}>
                <Text style={[s.eventTitle, { color: colors.text }]}>{event.title}</Text>
                <Text style={[s.eventSub, { color: colors.muted }]} numberOfLines={1}>{event.subtitle}</Text>
              </View>
              <Text style={[s.eventTime, { color: colors.muted }]}>{relativeTime(event.date)}</Text>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:   { flex: 1 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1 },
  iconBtn:     { padding: 5 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, flex: 1, textAlign: 'center', marginHorizontal: 10 },
  stateTitle:  { fontFamily: 'Poppins_600SemiBold', fontSize: 17, textAlign: 'center' },
  stateSub:    { fontFamily: 'Poppins_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  scroll:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  hint:        { fontFamily: 'Poppins_400Regular', fontSize: 12, textAlign: 'center', marginBottom: 14, opacity: 0.7 },
  eventCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3,
  },
  eventIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  eventBody: { flex: 1 },
  eventTitle:  { fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  eventSub:    { fontFamily: 'Poppins_400Regular', fontSize: 12, marginTop: 2 },
  eventTime:   { fontFamily: 'Poppins_400Regular', fontSize: 11, marginLeft: 6 },
});
