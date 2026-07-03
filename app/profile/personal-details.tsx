import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

export default function PersonalDetailsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const DetailItem = ({ label, value, icon }: { label: string; value: string; icon: any }) => (
    <View style={styles.detailItem}>
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={20} color={Colors.light.primary} />
      </View>
      <View style={styles.detailTextContainer}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value || 'Not provided'}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <DetailItem label="Full Name" value={user?.name || ''} icon="person-outline" />
          <View style={styles.divider} />
          <DetailItem label="Email Address" value={user?.email || ''} icon="mail-outline" />
          <View style={styles.divider} />
          <DetailItem label="Blood Group" value={user?.bloodGroup || ''} icon="water-outline" />
        </View>
      </ScrollView>
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
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  detailTextContainer: {
    flex: 1,
  },
  label: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#888',
  },
  value: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: '#333',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginLeft: 55,
  },
});
