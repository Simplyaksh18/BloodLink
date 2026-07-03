import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DonorStatus } from '../types';

interface Props {
  donorStatus: DonorStatus | undefined;
  daysRemaining?: number | null;
}

const STATUS_CONFIG: Record<DonorStatus, { label: string; color: string; icon: string }> = {
  ACTIVE:        { label: 'Eligible Donor', color: '#27AE60', icon: 'checkmark-circle' },
  PENDING_REVIEW:{ label: 'Ready to Register', color: '#2980B9', icon: 'time' },
  DEFERRED:      { label: 'Donor Deferred',  color: '#E67E22', icon: 'timer-outline' },
  INELIGIBLE:    { label: 'Not Eligible',    color: '#E74C3C', icon: 'close-circle' },
  NEVER_DONATED: { label: 'Become a Donor',  color: '#95A5A6', icon: 'person-add-outline' },
};

export default function EligibilityBadge({ donorStatus, daysRemaining }: Props) {
  const router = useRouter();

  if (!donorStatus) return null;

  const cfg = STATUS_CONFIG[donorStatus];
  const label =
    donorStatus === 'DEFERRED' && daysRemaining != null
      ? `${daysRemaining}d until eligible`
      : cfg.label;

  return (
    <TouchableOpacity
      style={[styles.badge, { backgroundColor: cfg.color + '18', borderColor: cfg.color + '55' }]}
      onPress={() => router.push('/(modals)/donate-blood')}
      activeOpacity={0.7}
    >
      <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
      <Text style={[styles.label, { color: cfg.color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  label: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },
});
