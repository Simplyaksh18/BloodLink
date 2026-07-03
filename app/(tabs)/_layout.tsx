import React, { useState, useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { messageService } from '../../services/messageService';
import { getSocket } from '../../services/socketService';
import { useAuthStore } from '../../store/authStore';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  console.log('[Theme] tab bar applied');
  const bottomPad = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : 20;
  const barHeight = Platform.OS === 'android' ? 58 + insets.bottom : 85;

  const user = useAuthStore(state => state.user);
  const isBloodBank = user?.role === 'BLOOD_BANK';
  const [msgUnread, setMsgUnread] = useState(0);

  // Only fetch after the user is authenticated — avoids a premature 401 that
  // the apiClient interceptor would handle by clearing stored credentials.
  useEffect(() => {
    if (!user?.id) return;
    messageService.getConversations()
      .then(res => {
        if (res.success && res.data) {
          const total = res.data.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
          setMsgUnread(total);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  // Increment badge on incoming messages via socket
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMsgNew = () => setMsgUnread(prev => prev + 1);
    socket.on('message:new', onMsgNew);
    return () => { socket.off('message:new', onMsgNew); };
  }, []);

  // Reset badge when user logs out
  useEffect(() => {
    if (!user) setMsgUnread(0);
  }, [user]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.light.primary,
        tabBarInactiveTintColor: colors.icon,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 10,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          height: barHeight,
          paddingBottom: bottomPad,
          paddingTop: 5,
        },
        tabBarLabelStyle: {
          fontFamily: 'Poppins_500Medium',
          fontSize: 10,
          paddingBottom: Platform.OS === 'android' ? 2 : 0,
        },
      }}>
      {/* Donor/recipient-only tabs — hidden for blood bank role */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          href: isBloodBank ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="request"
        options={{
          title: 'Request',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="water-plus" size={24} color={color} />,
          href: isBloodBank ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubbles-outline" size={22} color={color} />,
          href: isBloodBank ? null : undefined,
          tabBarBadge: msgUnread > 0 ? (msgUnread > 99 ? '99+' : msgUnread) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.light.primary,
            color: '#fff',
            fontSize: 10,
            minWidth: 18,
            height: 18,
          },
        }}
        listeners={{
          tabPress: () => setMsgUnread(0),
        }}
      />
      {/* Blood bank Home tab — shown only for BLOOD_BANK role */}
      <Tabs.Screen
        name="blood-bank-dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} />,
          href: isBloodBank ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
