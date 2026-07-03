import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Image,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useForm, Controller } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { requestService, uploadService } from '../../services/bloodService';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socketService';
import { timeAgo } from '../../utils/timeAgo';
import { messageService } from '../../services/messageService';

const LEVEL_TO_URGENCY: Record<string, 'RED' | 'YELLOW' | 'GREEN'> = {
  critical: 'RED',
  moderate: 'YELLOW',
  normal:   'GREEN',
  stable:   'GREEN',
};

// Backend expects exactly 'critical' | 'moderate' | 'stable' — 'normal' must map to 'stable'
const LEVEL_TO_EMERGENCY_LEVEL: Record<string, 'critical' | 'moderate' | 'stable'> = {
  critical: 'critical',
  moderate: 'moderate',
  normal:   'stable',
  stable:   'stable',
};

// Dev fallback when device location permission is denied or unavailable
const DEV_FALLBACK = { lat: 11.0168, lng: 76.9558, city: 'Coimbatore' };

function getStatusBadge(rawStatus?: string): { label: string; color: string; bg: string } {
  switch (rawStatus) {
    case 'OPEN':        return { label: 'Pending',     color: '#2980B9', bg: '#EBF5FB' };
    case 'ACTIVE':      return { label: 'Active',      color: '#27AE60', bg: '#EAFAF1' };
    case 'IN_PROGRESS': return { label: 'In Progress', color: '#8E44AD', bg: '#F5EEF8' };
    case 'FULFILLED':   return { label: 'Fulfilled',   color: '#16A085', bg: '#E8F8F5' };
    case 'CANCELLED':   return { label: 'Cancelled',   color: '#7F8C8D', bg: '#F2F3F4' };
    case 'EXPIRED':     return { label: 'Expired',     color: '#E67E22', bg: '#FEF9E7' };
    default:            return { label: 'Pending',     color: '#2980B9', bg: '#EBF5FB' };
  }
}

function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';
  return timeAgo(isoString);
}

export default function RequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { targetDonorId, targetDonorName, targetDonorBloodGroup } = useLocalSearchParams<{
    targetDonorId?: string;
    targetDonorName?: string;
    targetDonorBloodGroup?: string;
  }>();
  const { control, handleSubmit, reset, setValue } = useForm();
  const [submitting, setSubmitting] = useState(false);
  const [activeSegment, setActiveSegment] = useState<'new' | 'activity'>('new');
  const [bankChatLoading, setBankChatLoading] = useState<Record<string, boolean>>({});

  // My Requests state
  const [myRequests, setMyRequests]   = useState<any[]>([]);
  const [acceptedReqs, setAcceptedReqs] = useState<any[]>([]);
  const [personalReqs, setPersonalReqs] = useState<any[]>([]);
  const [personalLoading, setPersonalLoading] = useState<Record<string, boolean>>({});
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState<Record<string, boolean>>({});

  // Proof modal state
  const [proofModalRequestId, setProofModalRequestId] = useState<string | null>(null);
  const [proofNote, setProofNote] = useState('');
  const [proofPhotoUri, setProofPhotoUri] = useState<string | null>(null);
  const [proofPhotoMime, setProofPhotoMime] = useState<string>('image/jpeg');
  const [proofSubmitting, setProofSubmitting] = useState(false);

  const user = useAuthStore(state => state.user);

  const loadActivity = useCallback(async () => {
    setLoadingActivity(true);
    try {
      console.log('[AcceptedRequests] fetching');
      const [mine, accepted, targeted] = await Promise.all([
        requestService.getMyRequests(),
        requestService.getAcceptedRequests(),
        requestService.getTargetedRequests(),
      ]);

      const mineItems     = mine?.data     ?? [];
      const accItems      = accepted?.data ?? [];
      const targetedItems = targeted?.data ?? [];

      console.log('[MyActivity] myRequests count:', mineItems.length);
      console.log('[AcceptedRequests] response count:', accItems.length);
      console.log('[TargetedActivity] personal requests count:', targetedItems.length);
      accItems.forEach((item: any, idx: number) => {
        console.log('[AcceptedRequests] mapped item', idx, '— requestId:', item?.requestId, 'status:', item?.requestStatus, 'proofSubmitted:', !!item?.proofSubmittedAt);
      });

      setMyRequests(mineItems);
      setAcceptedReqs(accItems);
      setPersonalReqs(targetedItems);
    } catch (err) {
      console.log('[RequestLifecycle] load activity error:', err);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [loadActivity])
  );

  // When arriving with targeted donor params, switch to New Request and log
  useEffect(() => {
    if (targetDonorId) {
      setActiveSegment('new');
      console.log('[TargetedRequestUI] selected donorId:', targetDonorId);
      console.log('[TargetedRequestUI] selected donorName:', targetDonorName ?? 'unknown');
    }
  }, [targetDonorId, targetDonorName]);

  // Pre-fill blood group from user profile
  useEffect(() => {
    const userBg = (user as any)?.bloodGroup ?? '';
    if (userBg) setValue('bloodGroup', userBg);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    console.log('[KeyboardSafe] focused input should remain visible');
  }, []);

  // Real-time: refetch when a request status changes via socket
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onRequestUpdated = (data: { requestId: string; status: string }) => {
      console.log('[Socket] request:updated', data.requestId, data.status);
      loadActivity();
    };

    socket.on('request:updated', onRequestUpdated);
    return () => { socket.off('request:updated', onRequestUpdated); };
  }, [loadActivity]);

  const handleCancelRequest = async (id: string) => {
    console.log('[RequestLifecycle] cancel pressed');
    Alert.alert('Cancel Request', 'Are you sure you want to cancel this blood request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          setLifecycleLoading(p => ({ ...p, [`cancel_${id}`]: true }));
          try {
            await requestService.cancelRequest(id);
            console.log('[RequestLifecycle] cancel success');
            await loadActivity();
          } catch (err: any) {
            const msg = err?.response?.data?.message ?? 'Failed to cancel request';
            Alert.alert('Error', msg);
          } finally {
            setLifecycleLoading(p => ({ ...p, [`cancel_${id}`]: false }));
          }
        },
      },
    ]);
  };

  const handleFulfillRequest = async (id: string) => {
    console.log('[RequestLifecycle] fulfill pressed');
    Alert.alert('Mark as Complete', 'Mark this request as fulfilled? A donor has donated blood.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Mark Complete',
        onPress: async () => {
          setLifecycleLoading(p => ({ ...p, [`fulfill_${id}`]: true }));
          try {
            await requestService.fulfillRequest(id);
            console.log('[RequestLifecycle] fulfill success');
            await loadActivity();
          } catch (err: any) {
            const msg = err?.response?.data?.message ?? 'Failed to mark as fulfilled';
            Alert.alert('Error', msg);
          } finally {
            setLifecycleLoading(p => ({ ...p, [`fulfill_${id}`]: false }));
          }
        },
      },
    ]);
  };

  const handleOpenBankChat = async (requestId: string, bloodBankId: string) => {
    setBankChatLoading(p => ({ ...p, [requestId]: true }));
    console.log('[ChatLock] conversationId: pending | requestId:', requestId);
    try {
      const res = await messageService.createOrGetBankRequestConversation(requestId);
      if (res.success && res.data) {
        const { conversationId, bankName, requestStatus } = res.data;
        console.log('[ChatLock] conversationId:', conversationId);
        console.log('[ChatLock] requestId:', requestId);
        console.log('[ChatLock] requestStatus:', requestStatus);
        const CLOSED = ['FULFILLED', 'CANCELLED', 'EXPIRED'];
        const closed = CLOSED.includes(requestStatus);
        console.log('[ChatLock] isClosed:', closed);
        console.log('[ChatLock] inputDisabled:', closed);
        console.log('[ChatLock] closedReason:', closed ? `request is ${requestStatus.toLowerCase()}` : 'none');
        router.push(
          `/(modals)/chat?conversationId=${conversationId}&name=${encodeURIComponent(bankName)}&role=Bank` as any
        );
      } else {
        Alert.alert('Error', (res as any)?.message ?? 'Could not open bank chat.');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Could not open bank chat.';
      Alert.alert('Error', msg);
    } finally {
      setBankChatLoading(p => ({ ...p, [requestId]: false }));
    }
  };

  const handlePickProofPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo access to upload proof.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      setProofPhotoUri(asset.uri);
      setProofPhotoMime(asset.mimeType ?? 'image/jpeg');
    }
  };

  const handleSubmitProof = async () => {
    if (!proofModalRequestId) return;
    if (!proofPhotoUri) {
      Alert.alert('Photo required', 'Please upload donation proof photo.');
      return;
    }
    console.log('[DonationProof] submit pressed');
    setProofSubmitting(true);
    try {
      // Upload photo first, then submit proof with the returned URL
      const uploadRes = await uploadService.uploadDocument(proofPhotoUri, 'PROOF', proofPhotoMime);
      if (!uploadRes?.success || !uploadRes.data?.url) {
        throw new Error(uploadRes?.message ?? 'Photo upload failed');
      }
      const proofImageUrl = uploadRes.data.url;
      console.log('[DonationProof] photo uploaded:', proofImageUrl);

      const res = await requestService.submitProof(proofModalRequestId, proofNote || undefined, proofImageUrl);
      if (res?.success) {
        console.log('[DonationProof] backend success');
        setProofModalRequestId(null);
        setProofNote('');
        setProofPhotoUri(null);
        await loadActivity();
        Alert.alert('Thank you!', 'Your donation proof has been submitted.');
      } else {
        throw new Error(res?.message ?? 'Failed');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to submit proof';
      console.log('[DonationProof] error:', msg);
      Alert.alert('Error', msg);
    } finally {
      setProofSubmitting(false);
    }
  };

  const onSubmit = async (data: any) => {
    setSubmitting(true);
    try {
      let lat = DEV_FALLBACK.lat;
      let lng = DEV_FALLBACK.lng;
      let city = DEV_FALLBACK.city;

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
          city = geo?.city ?? DEV_FALLBACK.city;
        }
      } catch {
        // location unavailable — using dev fallback
      }

      const levelKey = String(data.level ?? 'critical').trim().toLowerCase();
      const urgency: 'RED' | 'YELLOW' | 'GREEN' = LEVEL_TO_URGENCY[levelKey] ?? 'RED';
      const emergencyLevel: 'critical' | 'moderate' | 'stable' =
        LEVEL_TO_EMERGENCY_LEVEL[levelKey] ?? 'critical';
      const requiredBy = new Date(Date.now() + 24 * 3_600_000).toISOString();

      const isTargeted = !!targetDonorId;
      console.log('[TargetedRequestUI] submitting targeted request:', isTargeted);

      const payload = {
        bloodGroup:        (data.bloodGroup ?? '').trim(),
        units:             Number(data.units),
        hospitalName:      (data.hospital ?? '').trim(),
        address:           (data.hospital ?? '').trim(),
        city,
        urgency,
        emergencyLevel,
        contactPhone:      (data.phone ?? '').trim(),
        hospitalLatitude:  lat,
        hospitalLongitude: lng,
        requiredBy,
        documents:         [],
        ...(targetDonorId && { targetedDonorId: targetDonorId }),
      };

      console.log('[RequestBlood] sanitized backend payload:', payload);

      const response = await requestService.createRequest(payload as any);

      if (response?.success) {
        const conversationId = (response as any)?.data?.conversationId as string | undefined;
        reset();
        router.replace('/(tabs)/request' as any);

        if (targetDonorId && conversationId) {
          console.log('[TargetedRequestUI] targeted request success');
          console.log('[TargetedRequestUI] conversationId:', conversationId);
          console.log('[TargetedRequestUI] navigating to chat');
          router.push(`/(modals)/chat?conversationId=${encodeURIComponent(conversationId)}` as any);
        } else {
          const successMsg = targetDonorId
            ? `Your request has been sent to ${targetDonorName ?? 'the selected donor'} only.`
            : 'Your blood request has been posted. Nearby donors will be notified.';
          Alert.alert('Success', successMsg);
          setActiveSegment('activity');
          loadActivity();
        }
      } else {
        Alert.alert('Error', (response as any)?.message ?? 'Failed to post request. Please try again.');
      }
    } catch (err: any) {
      const serverMsg = err?.response?.data?.message ?? err?.response?.data?.error;
      console.error('[RequestBlood] error:', err?.response?.data ?? err?.message ?? err);
      Alert.alert('Error', serverMsg ?? 'Failed to post request. Please check your input and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Blood Requests</Text>
      </View>

      {/* Segment switcher */}
      <View style={[styles.segmentRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.segmentBtn, { backgroundColor: colors.surface }, activeSegment === 'new' && styles.segmentBtnActive]}
          onPress={() => setActiveSegment('new')}
        >
          <Text style={[styles.segmentText, { color: colors.muted }, activeSegment === 'new' && styles.segmentTextActive]}>
            New Request
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, { backgroundColor: colors.surface }, activeSegment === 'activity' && styles.segmentBtnActive]}
          onPress={() => {
            setActiveSegment('activity');
            loadActivity();
          }}
        >
          <Text style={[styles.segmentText, { color: colors.muted }, activeSegment === 'activity' && styles.segmentTextActive]}>
            My Activity
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Keyboard-safe body: wraps both segments so the keyboard never covers inputs ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >

      {/* ── New Request form ── */}
      {activeSegment === 'new' && (
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">

          {/* Targeted donor banner — only shown when Request Blood was tapped on a specific donor */}
          {targetDonorId ? (
            <View style={styles.targetedBanner}>
              <View style={styles.targetedBannerLeft}>
                <Ionicons name="person-circle-outline" size={22} color="#1E8449" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.targetedBannerLabel}>Requesting blood from:</Text>
                  <Text style={styles.targetedBannerName}>{targetDonorName ?? 'Selected Donor'}</Text>
                  {targetDonorBloodGroup ? (
                    <Text style={styles.targetedBannerBg}>Donor blood group: {targetDonorBloodGroup}</Text>
                  ) : null}
                  <Text style={styles.targetedBannerNote}>Only this donor will be notified.</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => router.replace('/(tabs)/request' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={20} color="#aaa" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.infoBox, { backgroundColor: colors.surface }]}>
              <Ionicons name="alert-circle-outline" size={24} color={Colors.light.primary} />
              <Text style={styles.infoText}>
                Fill out this form to notify nearby donors about your urgent requirement.
              </Text>
            </View>
          )}

          <Text style={[styles.label, { color: colors.text }]}>Blood Group Required</Text>
          <Controller
            control={control}
            name="bloodGroup"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                placeholder="E.g., A+, O-"
                placeholderTextColor={colors.inputPlaceholder}
                onChangeText={onChange}
                value={value}
              />
            )}
          />

          <Text style={[styles.label, { color: colors.text }]}>Units Required</Text>
          <Controller
            control={control}
            name="units"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                placeholder="Number of units"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="numeric"
                onChangeText={onChange}
                value={value}
              />
            )}
          />

          <Text style={[styles.label, { color: colors.text }]}>Hospital Name</Text>
          <Controller
            control={control}
            name="hospital"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                placeholder="Where is the patient?"
                placeholderTextColor={colors.inputPlaceholder}
                onChangeText={onChange}
                value={value}
              />
            )}
          />

          <Text style={[styles.label, { color: colors.text }]}>Emergency Level</Text>
          <Controller
            control={control}
            name="level"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                placeholder="Critical / Moderate / Normal"
                placeholderTextColor={colors.inputPlaceholder}
                onChangeText={onChange}
                value={value}
              />
            )}
          />

          <Text style={[styles.label, { color: colors.text }]}>Contact Phone</Text>
          <Controller
            control={control}
            name="phone"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.inputText, borderColor: colors.border }]}
                placeholder="Phone number for donors to contact"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="phone-pad"
                onChangeText={onChange}
                value={value}
              />
            )}
          />

          <TouchableOpacity
            style={[styles.submitButton, submitting && { opacity: 0.7 }]}
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Request</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── My Activity ── */}
      {activeSegment === 'activity' && (
        <ScrollView
          contentContainerStyle={styles.activityContent}
          refreshControl={
            <RefreshControl refreshing={loadingActivity} onRefresh={loadActivity} />
          }
        >
          {/* My Blood Requests (requester side) */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>My Blood Requests</Text>
          {myRequests.length === 0 && !loadingActivity ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No requests yet.</Text>
          ) : (
            myRequests.map((req) => {
              const badge = getStatusBadge(req.rawStatus);
              const canCancel  = req.rawStatus === 'OPEN' || req.rawStatus === 'ACTIVE' || req.rawStatus === 'IN_PROGRESS';
              const canFulfill = req.rawStatus === 'OPEN' || req.rawStatus === 'ACTIVE' || req.rawStatus === 'IN_PROGRESS';
              // Show "Chat with Bank" button when this is a bank request that bank has engaged with
              const isBankReq  = !!req.bloodBankId;
              const bankChatVisible = isBankReq && (
                req.rawStatus === 'IN_PROGRESS' || req.rawStatus === 'FULFILLED' ||
                req.rawStatus === 'CANCELLED'   || req.rawStatus === 'EXPIRED'
              );
              const cancelLoading   = lifecycleLoading[`cancel_${req.id}`];
              const fulfillLoading  = lifecycleLoading[`fulfill_${req.id}`];
              const bankChatLoadi   = bankChatLoading[req.id];
              console.log('[MyRequests] requestId:', req.id, '| rawStatus:', req.rawStatus, '| bloodBankId:', req.bloodBankId ?? 'none');
              if (canCancel)       console.log('[UI-Render] Rendering button: CancelRequest  requestId:', req.id);
              if (canFulfill)      console.log('[UI-Render] Rendering button: MarkComplete   requestId:', req.id);
              if (bankChatVisible) console.log('[UI-Render] Rendering button: ChatWithBank   requestId:', req.id);
              return (
                <View key={req.id} style={[styles.reqCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.reqCardTop}>
                    <View style={styles.reqCardLeft}>
                      <Text style={styles.reqBloodGroup}>{req.bloodGroup}</Text>
                      <Text style={[styles.reqHospital, { color: colors.muted }]} numberOfLines={1}>{req.hospitalName}</Text>
                      <Text style={[styles.reqTime, { color: colors.muted }]}>{formatRelativeTime(req.createdAt)}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                  </View>

                  {(canCancel || canFulfill) && (
                    <View style={styles.reqActions}>
                      {canCancel && (
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.cancelBtn, { backgroundColor: colors.card }, cancelLoading && { opacity: 0.6 }]}
                          onPress={() => handleCancelRequest(req.id)}
                          disabled={cancelLoading}
                        >
                          {cancelLoading
                            ? <ActivityIndicator size="small" color="#C0392B" />
                            : <Text style={styles.cancelBtnText}>Cancel Request</Text>
                          }
                        </TouchableOpacity>
                      )}
                      {canFulfill && (
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.fulfillBtn, fulfillLoading && { opacity: 0.6 }]}
                          onPress={() => handleFulfillRequest(req.id)}
                          disabled={fulfillLoading}
                        >
                          {fulfillLoading
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.fulfillBtnText}>Mark as Complete</Text>
                          }
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {bankChatVisible && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.bankChatBtn, bankChatLoadi && { opacity: 0.6 }]}
                      onPress={() => handleOpenBankChat(req.id, req.bloodBankId!)}
                      disabled={bankChatLoadi}
                    >
                      {bankChatLoadi
                        ? <ActivityIndicator size="small" color={Colors.light.primary} />
                        : <>
                            <Ionicons name="chatbubble-outline" size={14} color={Colors.light.primary} />
                            <Text style={styles.bankChatBtnText}>Chat with Bank</Text>
                          </>
                      }
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}

          {/* Personal Requests — targeted directly at this donor */}
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Personal Requests</Text>
          {personalReqs.length === 0 && !loadingActivity ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No personal requests assigned to you.</Text>
          ) : (
            personalReqs.map((item) => {
              const isAccepted     = item.donorResponseStatus === 'ACCEPTED';
              const canProof       = isAccepted && (
                item.requestStatus === 'OPEN' || item.requestStatus === 'ACTIVE' || item.requestStatus === 'IN_PROGRESS'
              );
              const alreadySubmitted = !!item.proofSubmittedAt;
              console.log('[TargetedActivity] rendering personal request:', item.requestId,
                '| accepted:', isAccepted, '| proofSubmitted:', alreadySubmitted);
              if (canProof && !alreadySubmitted) console.log('[TargetedActivity] rendering SubmitProof requestId:', item.requestId);
              console.log('[TargetedActivity] proofSubmitted:', alreadySubmitted);

              const badge          = getStatusBadge(item.requestStatus);
              const acceptLoading  = personalLoading[`accept_${item.requestId}`];
              const declineLoading = personalLoading[`decline_${item.requestId}`];

              const handleAccept = async () => {
                console.log('[TargetedActivity] accept pressed:', item.requestId);
                setPersonalLoading(p => ({ ...p, [`accept_${item.requestId}`]: true }));
                try {
                  const res = await requestService.respondToRequest(item.requestId, 'ACCEPTED');
                  if (res?.success) {
                    const convId = (res as any)?.data?.conversationId as string | undefined;
                    console.log('[TargetedActivity] accept success requestId:', item.requestId);
                    console.log('[TargetedActivity] conversationId:', convId ?? 'none');
                    // Optimistic: flip to accepted immediately so Accept/Decline disappear
                    console.log('[TargetedActivity] local state set accepted:', item.requestId);
                    setPersonalReqs(prev => prev.map(p =>
                      p.requestId === item.requestId
                        ? { ...p, donorResponseStatus: 'ACCEPTED', conversationId: convId ?? p.conversationId }
                        : p
                    ));
                    // Navigate to chat, then refresh in background
                    if (convId) {
                      router.push(`/(modals)/chat?conversationId=${encodeURIComponent(convId)}` as any);
                    }
                    loadActivity(); // background sync — don't await
                  } else {
                    Alert.alert('Error', (res as any)?.message ?? 'Failed to accept');
                  }
                } catch (e: any) {
                  Alert.alert('Error', e?.response?.data?.message ?? e?.message ?? 'Failed to accept');
                } finally {
                  setPersonalLoading(p => ({ ...p, [`accept_${item.requestId}`]: false }));
                }
              };

              const handleDecline = async () => {
                console.log('[TargetedActivity] decline pressed:', item.requestId);
                setPersonalLoading(p => ({ ...p, [`decline_${item.requestId}`]: true }));
                try {
                  await requestService.respondToRequest(item.requestId, 'DECLINED');
                  await loadActivity();
                } catch (e: any) {
                  Alert.alert('Error', e?.response?.data?.message ?? e?.message ?? 'Failed to decline');
                } finally {
                  setPersonalLoading(p => ({ ...p, [`decline_${item.requestId}`]: false }));
                }
              };

              return (
                <View key={item.requestId} style={[styles.reqCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.reqCardTop}>
                    <View style={styles.reqCardLeft}>
                      <Text style={styles.reqBloodGroup}>{item.bloodGroup}</Text>
                      <Text style={[styles.reqHospital, { color: colors.muted }]} numberOfLines={1}>{item.hospitalName}</Text>
                      <Text style={[styles.reqTime, { color: colors.muted }]}>From: {item.requesterName} · {item.units} unit(s)</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: badge.color }]}>Personal</Text>
                    </View>
                  </View>

                  {/* Message button — visible once conversation exists */}
                  {item.conversationId && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.bankChatBtn, { marginBottom: 6 }]}
                      onPress={() => router.push(`/(modals)/chat?conversationId=${encodeURIComponent(item.conversationId)}` as any)}
                    >
                      <Ionicons name="chatbubble-outline" size={14} color={Colors.light.primary} />
                      <Text style={styles.bankChatBtnText}>Message Requester</Text>
                    </TouchableOpacity>
                  )}

                  {!isAccepted ? (
                    /* Pre-accept: show Accept / Decline */
                    <View style={styles.reqActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.fulfillBtn, acceptLoading && { opacity: 0.6 }]}
                        onPress={handleAccept}
                        disabled={!!acceptLoading || !!declineLoading}
                      >
                        {acceptLoading
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={styles.fulfillBtnText}>Accept</Text>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.cancelBtn, { backgroundColor: colors.card }, declineLoading && { opacity: 0.6 }]}
                        onPress={handleDecline}
                        disabled={!!acceptLoading || !!declineLoading}
                      >
                        {declineLoading
                          ? <ActivityIndicator size="small" color="#C0392B" />
                          : <Text style={styles.cancelBtnText}>Decline</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ) : (
                    /* Post-accept: proof flow (same as Accepted Donations) */
                    <>
                      {alreadySubmitted && (
                        <View style={styles.proofDoneRow}>
                          <Ionicons name="checkmark-circle" size={14} color="#16A085" />
                          <Text style={styles.proofDoneText}>Proof submitted</Text>
                        </View>
                      )}
                      {canProof && !alreadySubmitted && (
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.proofBtn]}
                          onPress={() => {
                            console.log('[DonationProof] submit pressed');
                            setProofModalRequestId(item.requestId);
                            setProofNote('');
                          }}
                        >
                          <Ionicons name="document-text-outline" size={14} color={Colors.light.primary} />
                          <Text style={styles.proofBtnText}>Submit Donation Proof</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              );
            })
          )}

          {/* Accepted Donations (donor side) */}
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Accepted Donations</Text>
          {acceptedReqs.length === 0 && !loadingActivity ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No accepted requests yet.</Text>
          ) : (
            acceptedReqs.map((item) => {
              const badge = getStatusBadge(item.requestStatus);
              const canProof =
                item.requestStatus === 'OPEN' ||
                item.requestStatus === 'ACTIVE' ||
                item.requestStatus === 'IN_PROGRESS';
              const alreadySubmitted = !!item.proofSubmittedAt;
              console.log('[AcceptedDonations] item responseId:', item.responseId);
              console.log('[AcceptedDonations] requestStatus:', item.requestStatus);
              console.log('[AcceptedDonations] proofSubmitted:', alreadySubmitted);
              if (canProof && !alreadySubmitted) console.log('[UI-Render] Rendering button: SubmitProof');
              if (!canProof) console.log('[UI-Render] Hiding button: SubmitProof reason: status=', item.requestStatus);
              if (alreadySubmitted) console.log('[UI-Render] Hiding button: SubmitProof reason: alreadySubmitted');
              return (
                <View key={item.responseId} style={[styles.reqCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.reqCardTop}>
                    <View style={styles.reqCardLeft}>
                      <Text style={styles.reqBloodGroup}>{item.bloodGroup}</Text>
                      <Text style={[styles.reqHospital, { color: colors.muted }]} numberOfLines={1}>{item.hospitalName}</Text>
                      <Text style={[styles.reqTime, { color: colors.muted }]}>For: {item.requesterName}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                  </View>

                  {alreadySubmitted && (
                    <View style={styles.proofDoneRow}>
                      <Ionicons name="checkmark-circle" size={14} color="#16A085" />
                      <Text style={styles.proofDoneText}>Proof submitted</Text>
                    </View>
                  )}

                  {canProof && !alreadySubmitted && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.proofBtn]}
                      onPress={() => {
                        console.log('[DonationProof] submit pressed');
                        setProofModalRequestId(item.requestId);
                        setProofNote('');
                      }}
                    >
                      <Ionicons name="document-text-outline" size={14} color={Colors.light.primary} />
                      <Text style={styles.proofBtnText}>Submit Donation Proof</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Proof submission modal */}
      <Modal
        visible={proofModalRequestId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => { setProofModalRequestId(null); setProofNote(''); setProofPhotoUri(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}>
            <Text style={styles.modalTitle}>Submit Donation Proof</Text>
            <Text style={styles.modalSubtitle}>
              Upload a proof photo (required) and add an optional note.
            </Text>

            {/* Photo picker */}
            <TouchableOpacity style={styles.proofPhotoBox} onPress={handlePickProofPhoto}>
              {proofPhotoUri ? (
                <Image source={{ uri: proofPhotoUri }} style={styles.proofPhotoPreview} resizeMode="cover" />
              ) : (
                <View style={styles.proofPhotoPlaceholder}>
                  <Ionicons name="camera-outline" size={28} color="#aaa" />
                  <Text style={styles.proofPhotoLabel}>Upload proof photo</Text>
                  <Text style={styles.proofPhotoRequired}>Required</Text>
                </View>
              )}
            </TouchableOpacity>

            <TextInput
              style={[styles.input, { marginTop: 12, minHeight: 70, textAlignVertical: 'top' }]}
              placeholder='Note (optional) — e.g., "I donated at City Hospital today"'
              multiline
              value={proofNote}
              onChangeText={setProofNote}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => { setProofModalRequestId(null); setProofNote(''); setProofPhotoUri(null); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.fulfillBtn, (!proofPhotoUri || proofSubmitting) && { opacity: 0.4 }]}
                onPress={handleSubmitProof}
                disabled={!proofPhotoUri || proofSubmitting}
              >
                {proofSubmitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.fulfillBtnText}>Submit</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    color: '#333',
  },

  // Segment switcher
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  segmentBtnActive: {
    backgroundColor: Colors.light.primary,
  },
  segmentText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#666',
  },
  segmentTextActive: {
    color: '#fff',
  },

  // New Request form
  formContent: {
    padding: 20,
  },
  // Targeted donor banner
  targetedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: '#EAFAF1',
    borderWidth: 1.5,
    borderColor: '#27AE60',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },
  targetedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  targetedBannerLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: '#555',
    marginBottom: 1,
  },
  targetedBannerName: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: '#1E8449',
    marginBottom: 2,
  },
  targetedBannerBg: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  targetedBannerNote: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#27AE60',
    marginTop: 2,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#FDEDEC',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: Colors.light.primary,
    marginLeft: 10,
    flex: 1,
  },
  label: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    marginTop: 15,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E1E4E8',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: Colors.light.primary,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30,
  },
  submitButtonText: {
    fontFamily: 'Poppins_600SemiBold',
    color: '#fff',
    fontSize: 16,
  },

  // My Activity
  activityContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#333',
    marginBottom: 10,
  },
  emptyText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#aaa',
    marginBottom: 8,
  },

  // Request card
  reqCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  reqCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reqCardLeft: {
    flex: 1,
    marginRight: 10,
  },
  reqBloodGroup: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: Colors.light.primary,
    marginBottom: 2,
  },
  reqHospital: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#555',
    marginBottom: 2,
  },
  reqTime: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#aaa',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },

  // Action buttons
  reqActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#C0392B',
  },
  cancelBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#C0392B',
  },
  fulfillBtn: {
    backgroundColor: Colors.light.primary,
  },
  fulfillBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#fff',
  },
  proofBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: '#FDEDEC',
  },
  proofBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: Colors.light.primary,
  },
  bankChatBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.light.primary,
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  bankChatBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: Colors.light.primary,
  },
  proofDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  proofDoneText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#16A085',
  },

  // Proof modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#333',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#666',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  proofPhotoBox: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    overflow: 'hidden',
    height: 120,
  },
  proofPhotoPreview: {
    width: '100%',
    height: '100%',
  },
  proofPhotoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  proofPhotoLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#888',
    marginTop: 6,
  },
  proofPhotoRequired: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#E74C3C',
    marginTop: 2,
  },
});
