import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/Colors';

interface Props {
  targetDate: string;        // ISO date string
  onExpired?: () => void;    // called when countdown reaches 0
}

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
}

function calcRemaining(targetDate: string): Remaining | null {
  const ms = new Date(targetDate).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const days         = Math.floor(totalMinutes / (60 * 24));
  const hours        = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes      = totalMinutes % 60;
  return { days, hours, minutes };
}

export default function CountdownTimer({ targetDate, onExpired }: Props) {
  const [remaining, setRemaining] = useState<Remaining | null>(() => calcRemaining(targetDate));

  useEffect(() => {
    const tick = () => {
      const r = calcRemaining(targetDate);
      setRemaining(r);
      if (!r) onExpired?.();
    };

    // Update every minute
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [targetDate, onExpired]);

  if (!remaining) {
    return (
      <View style={styles.row}>
        <Text style={styles.expiredText}>Eligibility window reached — tap "Check Now"</Text>
      </View>
    );
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <View style={styles.row}>
      <Unit value={remaining.days}    label="Days"    accent />
      <Text style={styles.sep}>:</Text>
      <Unit value={remaining.hours}   label="Hours" />
      <Text style={styles.sep}>:</Text>
      <Unit value={remaining.minutes} label="Mins" />
    </View>
  );
}

function Unit({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <View style={styles.unit}>
      <Text style={[styles.digit, accent && styles.digitAccent]}>{String(value).padStart(2, '0')}</Text>
      <Text style={styles.unitLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  unit: {
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 58,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  digit: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 26,
    color: '#333',
    lineHeight: 32,
  },
  digitAccent: {
    color: Colors.light.primary,
  },
  unitLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  sep: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#CCC',
    marginBottom: 14,
  },
  expiredText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#27AE60',
    textAlign: 'center',
  },
});
