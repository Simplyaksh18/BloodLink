import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '../../context/ThemeContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { isDark, toggleTheme, colors } = useTheme();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const notifStr = await SecureStore.getItemAsync('settings_notifications');
        const locStr = await SecureStore.getItemAsync('settings_location');
        if (notifStr !== null) setNotificationsEnabled(notifStr === 'true');
        if (locStr !== null) setLocationEnabled(locStr === 'true');
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    };
    loadSettings();
  }, []);

  const handleToggleNotifications = async (val: boolean) => {
    setNotificationsEnabled(val);
    await SecureStore.setItemAsync('settings_notifications', String(val));
  };

  const handleToggleLocation = async (val: boolean) => {
    setLocationEnabled(val);
    await SecureStore.setItemAsync('settings_location', String(val));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>Preferences</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Dark Mode</Text>
            <Switch
              trackColor={{ false: '#767577', true: Colors.light.primary }}
              thumbColor="#fff"
              onValueChange={toggleTheme}
              value={isDark}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Push Notifications</Text>
            <Switch
              trackColor={{ false: '#767577', true: Colors.light.primary }}
              thumbColor="#fff"
              onValueChange={handleToggleNotifications}
              value={notificationsEnabled}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Location Services</Text>
            <Switch
              trackColor={{ false: '#767577', true: Colors.light.primary }}
              thumbColor="#fff"
              onValueChange={handleToggleLocation}
              value={locationEnabled}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.muted }]}>Support</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <TouchableOpacity style={styles.actionRow} onPress={() => Alert.alert('Help Center', 'Our Help Center is currently being updated. Please check back later or email support@bloodlink.app')}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Help Center</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity style={styles.actionRow} onPress={() => Alert.alert('Privacy Policy', 'Your data is strictly confidential. You are viewing the latest Privacy Policy.')}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity style={styles.actionRow} onPress={() => Alert.alert('Terms of Service', 'By using this app, you agree to our Terms of Service. Thank you for saving lives!')}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
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
  sectionTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#666',
    marginBottom: 10,
    marginLeft: 5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    marginBottom: 25,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
  },
  settingLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: '#333',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
});
