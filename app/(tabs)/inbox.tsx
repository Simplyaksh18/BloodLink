import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter, useFocusEffect } from 'expo-router';
import { messageService, ConversationListItem } from '../../services/messageService';
import { getSocket } from '../../services/socketService';
import { useAuthStore } from '../../store/authStore';

type Filter = 'all' | 'requests' | 'responded' | 'saved';

export default function InboxScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await messageService.getConversations();
      if (res.success && res.data) {
        setConversations(res.data);
        console.log(`[MessagesUI] conversations count: ${res.data.length}`);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      fetchConversations();

      // Listen for real-time updates
      const socket = getSocket();
      if (socket) {
        const handler = () => fetchConversations(true);
        socket.on('conversations:updated', handler);
        socket.on('message:new', handler);
        return () => {
          socket.off('conversations:updated', handler);
          socket.off('message:new', handler);
        };
      }
    }, [fetchConversations])
  );

  const filteredConversations = conversations.filter((c) => {
    if (filter === 'all' || filter === 'saved') return true;
    if (filter === 'requests') return c.myRole === 'requester';
    if (filter === 'responded') return c.myRole === 'donor';
    return true;
  });

  const navigateToChat = (conv: ConversationListItem) => {
    const otherName = conv.myRole === 'requester' ? conv.donorName : conv.requesterName;
    const role = conv.myRole === 'requester' ? 'Donor' : 'Requester';
    router.push(
      `/(modals)/chat?conversationId=${conv.conversationId}&name=${encodeURIComponent(otherName)}&role=${role}` as any
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Messages</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => fetchConversations()}>
          <Ionicons name="refresh-outline" size={24} color={colors.icon} />
        </TouchableOpacity>
      </View>

      {/* Filter Pills */}
      <View style={[styles.filterContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['all', 'requests', 'responded', 'saved'] as Filter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterPill, { backgroundColor: colors.surface }, filter === f && styles.filterPillActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, { color: colors.muted }, filter === f && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
          </View>
        ) : filteredConversations.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.iconCircle}>
              <Ionicons name="chatbubbles-outline" size={60} color={Colors.light.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Messages Yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>
              When you accept blood requests or connect with donors, your messages will appear here.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); fetchConversations(); }}
                colors={[Colors.light.primary]}
              />
            }
          >
            {filteredConversations.map((conv) => {
              const otherName = conv.myRole === 'requester' ? conv.donorName : conv.requesterName;
              const role     = conv.myRole === 'requester' ? 'Donor' : 'Requester';
              const timeStr  = conv.lastMessageAt ? messageService.formatDate(conv.lastMessageAt) : '';
              const isClosed = ['CANCELLED', 'EXPIRED', 'FULFILLED'].includes(conv.requestStatus);

              return (
                <TouchableOpacity
                  key={conv.conversationId}
                  style={[styles.chatCard, { borderBottomColor: colors.border }]}
                  onPress={() => navigateToChat(conv)}
                >
                  {/* Avatar */}
                  <View style={styles.avatarWrapper}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarInitial}>
                        {otherName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={[
                      styles.bloodGroupDot,
                      { borderColor: colors.card },
                      isClosed && styles.bloodGroupDotClosed,
                    ]}>
                      <Text style={styles.bloodGroupDotText}>{conv.bloodGroup}</Text>
                    </View>
                  </View>

                  <View style={styles.chatInfo}>
                    <View style={styles.chatHeaderRow}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>{otherName}</Text>
                        <Text style={[styles.roleTag, { color: colors.muted }]}>{role}</Text>
                      </View>
                      <Text style={[styles.chatTime, { color: colors.muted }, conv.unreadCount > 0 && { color: colors.text, fontFamily: 'Poppins_600SemiBold' }]}>
                        {timeStr}
                      </Text>
                    </View>

                    <View style={styles.chatFooterRow}>
                      <Text
                        style={[styles.lastMessage, { color: colors.muted }, conv.unreadCount > 0 && { color: colors.text, fontFamily: 'Poppins_600SemiBold' }]}
                        numberOfLines={1}
                      >
                        {conv.lastMessage || `${conv.hospitalName} · ${conv.bloodGroup}`}
                      </Text>
                      {conv.unreadCount > 0 && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadText}>{conv.unreadCount}</Text>
                        </View>
                      )}
                      {isClosed && (
                        <Ionicons name="lock-closed-outline" size={14} color={colors.muted} style={{ marginLeft: 4 }} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
  headerTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#111',
  },
  iconBtn: {
    marginLeft: 15,
  },
  filterContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  filterScroll: {
    paddingHorizontal: 20,
    gap: 10,
  },
  filterPill: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
  },
  filterPillActive: {
    backgroundColor: Colors.light.primary,
  },
  filterText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
    fontFamily: 'Poppins_600SemiBold',
  },
  content: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
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
  },
  listContent: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 15,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(231, 76, 60, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: Colors.light.primary,
  },
  bloodGroupDot: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  bloodGroupDotClosed: {
    backgroundColor: '#AAA',
  },
  bloodGroupDotText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 8,
    color: '#fff',
  },
  chatInfo: {
    flex: 1,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  chatName: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#222',
    marginRight: 6,
    flexShrink: 1,
  },
  roleTag: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#999',
  },
  chatTime: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#999',
  },
  unreadTime: {
    color: '#333',
    fontFamily: 'Poppins_600SemiBold',
  },
  chatFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#888',
    flex: 1,
    marginRight: 8,
  },
  unreadMessage: {
    fontFamily: 'Poppins_600SemiBold',
    color: '#333',
  },
  unreadBadge: {
    backgroundColor: Colors.light.primary,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    color: '#fff',
    fontFamily: 'Poppins_700Bold',
    fontSize: 10,
  },
});
