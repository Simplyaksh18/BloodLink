import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { messageService, MessageItem } from '../../services/messageService';
import { getSocket } from '../../services/socketService';
import { useAuthStore } from '../../store/authStore';

const CLOSED_STATUSES = ['CANCELLED', 'EXPIRED', 'FULFILLED'];

// ── Avatar emoji logic ─────────────────────────────────────────────────────────
// gender param is optional; falls back to a deterministic pick from the name.
const MALE_EMOJIS   = ['👨', '🧔', '👦', '👱'];
const FEMALE_EMOJIS = ['👩', '👧', '👱‍♀️', '🧕'];

function getAvatarEmoji(name: string, gender?: string): string {
  const g = gender?.toUpperCase();
  const hash = name.trim().split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  if (g === 'MALE')   return MALE_EMOJIS[hash   % MALE_EMOJIS.length];
  if (g === 'FEMALE') return FEMALE_EMOJIS[hash % FEMALE_EMOJIS.length];
  // No gender — pick from combined pool deterministically
  const all = [...MALE_EMOJIS, ...FEMALE_EMOJIS];
  return all[hash % all.length];
}

// ── Avatar background colours ─────────────────────────────────────────────────
const AVATAR_COLORS = ['#FDECEA', '#E8F5E9', '#E3F2FD', '#FFF3E0', '#F3E5F5'];
function getAvatarBg(name: string): string {
  const hash = name.trim().split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// ── Read-receipt tick ─────────────────────────────────────────────────────────
function ReadTick({ readAt }: { readAt: string | null }) {
  if (readAt) {
    // Double-tick (delivered + read)
    return <Text style={styles.readTick}>✓✓</Text>;
  }
  // Single tick (sent)
  return <Text style={[styles.readTick, styles.sentTick]}>✓</Text>;
}

export default function ChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  useEffect(() => { console.log('[Theme] applied screen: chat'); }, []);
  const { conversationId, name, role, gender } = useLocalSearchParams<{
    conversationId: string;
    name: string;
    role: string;
    gender?: string;
  }>();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [requestStatus, setRequestStatus] = useState('');
  const [isClosed, setIsClosed] = useState(false);
  const [hospitalName, setHospitalName] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [units, setUnits] = useState<number | null>(null);
  const [requesterName, setRequesterName] = useState('');
  const [donorName, setDonorName] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  const displayName = name || 'Unknown';
  const avatarEmoji  = getAvatarEmoji(displayName, gender);
  const avatarBg     = getAvatarBg(displayName);

  // ── Fetch messages ────────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await messageService.getConversation(conversationId);
      if (res.success && res.data) {
        setMessages(res.data.messages);
        setRequestStatus(res.data.requestStatus);
        setIsClosed(res.data.isClosed ?? CLOSED_STATUSES.includes(res.data.requestStatus));
        setHospitalName(res.data.hospitalName);
        setBloodGroup(res.data.bloodGroup ?? '');
        setUnits(res.data.units ?? null);
        setRequesterName(res.data.requesterName ?? '');
        setDonorName(res.data.donorName ?? '');
        console.log('[ChatLock] requestStatus:', res.data.requestStatus);
        console.log('[ChatLock] isClosed:', res.data.isClosed ?? false);
        console.log(`[MessagesUI] messages count: ${res.data.messages.length}`);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // ── Socket: new messages ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !conversationId) return;

    const handler = (msg: any) => {
      if (msg.conversationId !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, {
          id:             msg.id,
          conversationId: msg.conversationId,
          senderId:       msg.senderId,
          body:           msg.body,
          createdAt:      msg.createdAt,
          readAt:         msg.readAt ?? null,
          isMine:         msg.senderId === user?.id,
        }];
      });
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 80);
    };

    socket.on('message:new', handler);
    return () => { socket.off('message:new', handler); };
  }, [conversationId, user?.id]);

  // ── Scroll to end on load ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [loading]);

  // ── Send ──────────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    console.log('[ChatSend] pressed');
    console.log('[ChatSend] conversationId:', conversationId);
    console.log('[ChatSend] text length:', inputText.trim().length);
    if (!inputText.trim() || !conversationId || sending || isClosed) {
      if (isClosed) console.log('[ChatLock] send blocked: conversation is closed, requestStatus:', requestStatus);
      else console.log('[ChatSend] guard blocked — empty:', !inputText.trim(), '| noConvId:', !conversationId, '| sending:', sending);
      return;
    }
    const body = inputText.trim();
    console.log('[ChatSend] payload:', { body });
    setInputText('');
    setSending(true);
    try {
      const res = await messageService.sendMessage(conversationId, body);
      if (res.success && res.data) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.data!.id)) return prev;
          return [...prev, res.data!];
        });
        console.log('[ChatSend] API success:', res.data.id);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 80);
      } else {
        const errMsg = (res as any)?.message ?? 'Send failed';
        console.log('[ChatSend] API error:', errMsg);
        setInputText(body);
      }
    } catch (e: any) {
      const errMsg = e?.response?.data?.message ?? e?.message ?? String(e);
      console.log('[ChatSend] API error:', errMsg);
      setInputText(body);
    } finally {
      setSending(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Enhanced Header ──────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.icon} />
        </TouchableOpacity>

        {/* Emoji Avatar */}
        <View style={[styles.avatarCircle, { backgroundColor: avatarBg }]}>
          <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
          {/* Active dot */}
          <View style={styles.activeDot} />
        </View>

        {/* Name + status + hospital */}
        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
          <View style={styles.statusRow}>
            <View style={styles.activeDotInline} />
            <Text style={styles.activeText}>Active now</Text>
            {hospitalName ? (
              <>
                <Text style={[styles.dotSep, { color: colors.muted }]}>·</Text>
                <Text style={[styles.hospitalText, { color: colors.muted }]} numberOfLines={1}>{hospitalName}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Three-dot → Request Details */}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.surface }]}
          onPress={() => setShowDetails(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.icon} />
        </TouchableOpacity>
      </View>

      {/* Closed badge strip */}
      {isClosed && !loading && (
        <View style={styles.closedStrip}>
          {(() => { console.log('[ChatUI] closed banner shown:', requestStatus); return null; })()}
          <Ionicons name="lock-closed-outline" size={13} color="#888" />
          <Text style={styles.closedStripText}>
            This request is completed. Chat is now closed.
          </Text>
        </View>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
          </View>
        ) : messages.length === 0 ? (
          /* ── Empty state ──────────────────────────────────────────────────── */
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Text style={styles.emptyEmoji}>💬</Text>
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Start the conversation</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              You've accepted this request.{'\n'}Send a message to coordinate.
            </Text>
          </View>
        ) : (
          /* ── Messages list ────────────────────────────────────────────────── */
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.map((msg) => (
              <View
                key={msg.id}
                style={[styles.bubbleRow, msg.isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}
              >
                {/* Sender avatar (their messages only) */}
                {!msg.isMine && (
                  <View style={[styles.msgAvatar, { backgroundColor: avatarBg }]}>
                    <Text style={styles.msgAvatarEmoji}>{avatarEmoji}</Text>
                  </View>
                )}
                <View style={[
                  styles.messageBubble,
                  msg.isMine ? styles.myMessage : [styles.theirMessage, { backgroundColor: colors.card, borderColor: colors.border }],
                ]}>
                  <Text style={[styles.messageText, { color: colors.text }, msg.isMine && styles.myMessageText]}>
                    {msg.body}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.messageTime, msg.isMine && styles.myMessageTime]}>
                      {messageService.formatTime(msg.createdAt)}
                    </Text>
                    {msg.isMine && <ReadTick readAt={msg.readAt} />}
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ── Input bar (always above keyboard) ───────────────────────────── */}
        <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }, isClosed && { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.attachBtn} disabled={isClosed}>
            <Ionicons name="attach" size={22} color={isClosed ? colors.border : colors.icon} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText }, isClosed && { backgroundColor: colors.border, color: colors.muted }]}
            placeholder={isClosed ? 'Conversation closed' : 'Type a message...'}
            placeholderTextColor={colors.inputPlaceholder}
            value={inputText}
            onChangeText={setInputText}
            multiline
            editable={!isClosed}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || isClosed) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || isClosed || sending}
            activeOpacity={0.8}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Request Details Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={showDetails}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowDetails(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDetails(false)}
        >
          <View
            style={[styles.detailsSheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom + 12, 36) }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Handle bar */}
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            <Text style={[styles.sheetTitle, { color: colors.text }]}>Request Details</Text>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="water" size={18} color={Colors.light.primary} />
              </View>
              <View>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Blood Group</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{bloodGroup || '—'}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="business-outline" size={18} color={colors.icon} />
              </View>
              <View>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Hospital</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{hospitalName || '—'}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="person-outline" size={18} color={colors.icon} />
              </View>
              <View>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Requester</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{requesterName || '—'}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="layers-outline" size={18} color={colors.icon} />
              </View>
              <View>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>No. of Units Needed</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{units != null ? String(units) : '—'}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="radio-button-on-outline" size={18} color={colors.icon} />
              </View>
              <View>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Status</Text>
                <Text style={[
                  styles.detailValue,
                  { color: colors.text },
                  isClosed && { color: colors.muted },
                  requestStatus === 'ACTIVE' && { color: '#27AE60' },
                  requestStatus === 'IN_PROGRESS' && { color: '#27AE60' },
                ]}>
                  {requestStatus || '—'}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setShowDetails(false)}>
              <Text style={styles.sheetCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F6FA',
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  avatarEmoji: {
    fontSize: 26,
    lineHeight: 30,
  },
  activeDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2ECC71',
    borderWidth: 2,
    borderColor: '#fff',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 2,
  },
  headerName: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#1A1A1A',
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  activeDotInline: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2ECC71',
    marginRight: 4,
  },
  activeText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#2ECC71',
  },
  dotSep: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#BBB',
    marginHorizontal: 4,
  },
  hospitalText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#888',
    flexShrink: 1,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F6FA',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Closed strip ────────────────────────────────────────────────────────────
  closedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8F0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#FFE0B2',
  },
  closedStripText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
    flex: 1,
  },

  // ── Body ────────────────────────────────────────────────────────────────────
  keyboardView: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(231, 76, 60, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: '#222',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Messages ─────────────────────────────────────────────────────────────────
  chatContent: {
    padding: 16,
    paddingBottom: 20,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  msgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  msgAvatarEmoji: {
    fontSize: 16,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderRadius: 18,
  },
  myMessage: {
    backgroundColor: Colors.light.primary,
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  myMessageText: {
    color: '#fff',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  messageTime: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 10,
    color: '#AAAAAA',
  },
  myMessageTime: {
    color: 'rgba(255,255,255,0.65)',
  },
  readTick: {
    fontSize: 11,
    color: '#90CAF9',
    fontFamily: 'Poppins_600SemiBold',
  },
  sentTick: {
    color: 'rgba(255,255,255,0.5)',
  },

  // ── Input bar ────────────────────────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'android' ? 12 : 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EFEFEF',
  },
  inputBarClosed: {
    backgroundColor: '#FAFAFA',
  },
  attachBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    backgroundColor: '#F5F6FA',
    borderRadius: 21,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    marginRight: 8,
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#333',
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  inputDisabled: {
    backgroundColor: '#F0F0F0',
    color: '#BBB',
    borderColor: '#E5E5E5',
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sendBtnDisabled: {
    backgroundColor: '#D0D0D0',
    shadowOpacity: 0,
    elevation: 0,
  },

  // ── Request Details Modal ─────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  detailsSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 36,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E0',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#1A1A1A',
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 14,
  },
  detailIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F6FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#999',
    marginBottom: 1,
  },
  detailValue: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#222',
  },
  sheetCloseBtn: {
    marginTop: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetCloseBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#fff',
  },
});
