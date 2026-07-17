import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { donationService } from '../../services/bloodService';

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export default function DonationHistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    donationService.getHistory()
      .then(res => {
        if (res?.success) {
          const items = res.data ?? [];
          setHistory(items);
          console.log('[DonationHistory] count:', items.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Donation History</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.content}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.content}>
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="water-outline" size={60} color={Colors.light.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Donations Yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>
              You haven't made any blood donations through BloodLink yet. Start saving lives today!
            </Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.replace('/(modals)/donate-blood')}>
              <Text style={styles.actionBtnText}>Donate Blood</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <View style={styles.listHeader}>
            <Text style={[styles.countText, { color: colors.muted }]}>{history.length} donation{history.length !== 1 ? 's' : ''} recorded</Text>
            <TouchableOpacity style={styles.donorCardBtn} onPress={() => router.push('/profile/donor-card' as any)}>
              <Ionicons name="card-outline" size={16} color={Colors.light.primary} />
              <Text style={styles.donorCardBtnText}>Donor Card</Text>
            </TouchableOpacity>
          </View>
          {history.map((item, index) => (
            <View key={item.responseId || index} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardLeft}>
                <View style={styles.bloodDrop}>
                  <Ionicons name="water" size={28} color="#fff" />
                  <Text style={styles.bloodDropText}>{item.bloodGroup}</Text>
                </View>
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardDate, { color: colors.text }]}>{formatDate(item.donatedAt)}</Text>
                <Text style={[styles.cardHospital, { color: colors.muted }]} numberOfLines={1}>{item.hospitalName ?? '—'}</Text>
                {item.proofNote && (
                  <Text style={[styles.cardRecipient, { color: colors.muted }]} numberOfLines={1}>{item.proofNote}</Text>
                )}
              </View>
              <View style={styles.cardRight}>
                <View style={styles.unitsBadge}>
                  <Text style={styles.unitsText}>{item.units ?? 1}</Text>
                  <Text style={styles.unitsLabel}>unit{(item.units ?? 1) !== 1 ? 's' : ''}</Text>
                </View>
              </View>
            </View>
          ))}
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
  backBtn: {
    padding: 5,
  },
  headerTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    color: '#333',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 30,
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
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  countText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#888',
  },
  donorCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FDEDEC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  donorCardBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: Colors.light.primary,
  },
  historyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: '#F5F5F5',
  },
  cardLeft: {
    marginRight: 14,
  },
  bloodDrop: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  bloodDropText: {
    position: 'absolute',
    color: '#fff',
    fontFamily: 'Poppins_700Bold',
    fontSize: 10,
    bottom: 8,
  },
  cardBody: {
    flex: 1,
  },
  cardDate: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#222',
    marginBottom: 3,
  },
  cardHospital: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  cardRecipient: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#aaa',
  },
  cardRight: {
    marginLeft: 10,
    alignItems: 'center',
  },
  unitsBadge: {
    backgroundColor: '#FDEDEC',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  unitsText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: Colors.light.primary,
  },
  unitsLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 10,
    color: Colors.light.primary,
  },
});
