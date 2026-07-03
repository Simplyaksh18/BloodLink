import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { verificationService, DocVerificationType, VerificationStatusResponse, VerificationDoc } from '../../services/verificationService';
import VerificationBadge from '../../components/VerificationBadge';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/authService';
import { donorStatusService } from '../../services/donorStatusService';
import { useTheme } from '../../context/ThemeContext';

const ALL_TYPES: DocVerificationType[] = ['ID_PROOF', 'BLOOD_GROUP_PROOF', 'MEDICAL_SCREENING'];

const TYPE_INFO: Record<DocVerificationType, { label: string; description: string }> = {
  ID_PROOF: {
    label: 'ID Proof',
    description: 'Government-issued ID (Aadhaar, PAN, Passport, Driving License)',
  },
  BLOOD_GROUP_PROOF: {
    label: 'Blood Group Certificate',
    description: 'Lab report or medical certificate showing your blood group',
  },
  MEDICAL_SCREENING: {
    label: 'Medical Screening',
    description: 'Recent blood screening report (within 6 months)',
  },
  LICENSE: {
    label: 'Blood Bank License',
    description: 'Official blood bank operating license',
  },
};

export default function VerificationStatusScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, setUser } = useAuthStore();
  const [statusData, setStatusData] = useState<VerificationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<DocVerificationType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBloodBank = user?.role === 'BLOOD_BANK';
  const visibleTypes = isBloodBank ? [...ALL_TYPES, 'LICENSE' as DocVerificationType] : ALL_TYPES;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await verificationService.getStatus();
      if (res.success) {
        const statuses = Object.fromEntries(
          Object.entries(res.data?.verifications ?? {}).map(([k, v]) => [k, (v as any)?.status ?? 'NOT_SUBMITTED'])
        );
        console.log('[VerificationStatus] document statuses:', statuses);
        setStatusData(res.data);
      }
    } catch {
      setError('Failed to load verification status. Pull down to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const doLoad = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await verificationService.getStatus();
          if (isActive && res.success) {
            const statuses = Object.fromEntries(
              Object.entries(res.data?.verifications ?? {}).map(([k, v]) => [k, (v as any)?.status ?? 'NOT_SUBMITTED'])
            );
            console.log('[VerificationStatus] document statuses:', statuses);
            setStatusData(res.data);
          }
        } catch {
          if (isActive) setError('Failed to load verification status. Pull down to retry.');
        } finally {
          if (isActive) setLoading(false);
        }
      };

      doLoad();

      return () => {
        isActive = false;
      };
    }, [])
  );

  const refreshUserFlags = async () => {
    try {
      const [profileRes, donorRes, verifyRes] = await Promise.all([
        authService.getProfile(),
        donorStatusService.getStatus(),
        verificationService.getStatus(),
      ]);
      if (profileRes.success && profileRes.data) setUser(profileRes.data);
      if (verifyRes.success && verifyRes.data) setStatusData(verifyRes.data);
      console.log('[VerificationRefetch] refetchAuthMe isDonorEligible:', (profileRes.data as any)?.isDonorEligible ?? false);
      console.log('[VerificationRefetch] refetchDonorStatus:', (donorRes?.data as any)?.donorStatus ?? 'unknown');
    } catch {}
  };

  const handleUpload = async (type: DocVerificationType) => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      const fileSize = asset.size;
      const fileType = asset.mimeType ?? 'image/jpeg';
      const fileName = asset.name;

      setUploading(type);

      // Step 1: Get presigned URL
      const urlRes = await verificationService.requestUploadUrl(type, fileName, fileType, fileSize);
      if (!urlRes.success) throw new Error('Failed to get upload URL');

      const { uploadUrl, documentId, s3Key } = urlRes.data;

      // Step 2: Upload to S3
      // In DEV mode the backend returns a mock URL (storage.bloodlink.app) that doesn't
      // accept real traffic. Skip the PUT entirely — confirm-upload runs metadata-only
      // checks that don't require the file to be in S3.
      const isMockUrl =
        uploadUrl.includes('storage.bloodlink.app') ||
        uploadUrl.includes('mock-upload') ||
        uploadUrl.includes('localhost');

      if (!isMockUrl) {
        console.log('[Upload] Starting S3 PUT to:', uploadUrl.slice(0, 80) + '...');

        let fileBlob: Blob;
        try {
          const localResp = await fetch(asset.uri);
          if (!localResp.ok) throw new Error(`Could not read local file (${localResp.status})`);
          fileBlob = await localResp.blob();
        } catch (readErr: any) {
          console.error('[Upload] Local file read error:', readErr.message);
          throw new Error(`Could not read the selected file: ${readErr.message}`);
        }

        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': fileType },
          body: fileBlob,
        });

        if (!uploadResp.ok) {
          const errBody = await uploadResp.text().catch(() => '');
          console.error('[Upload] S3 rejected upload:', {
            status: uploadResp.status,
            url: uploadUrl.slice(0, 80),
            body: errBody.slice(0, 400),
          });
          if (uploadResp.status === 403) throw new Error('Upload link expired. Please try again.');
          if (uploadResp.status === 400) throw new Error('Invalid file for storage (400). Check file format.');
          throw new Error(`Storage upload failed (${uploadResp.status}). Please try again.`);
        }

        console.log('[Upload] S3 upload successful');
      } else {
        console.log('[Upload] DEV mode — mock URL detected, skipping S3 PUT');
      }

      // Step 3: Confirm upload — backend returns VERIFIED or REJECTED immediately
      const confirmRes = await verificationService.confirmUpload(documentId, s3Key, fileSize);

      if (confirmRes.success) {
        const doc = confirmRes.data;
        if (doc.status === 'VERIFIED') {
          Alert.alert('Document Verified!', `Your ${TYPE_INFO[type].label} has been verified successfully.`);
          await refreshUserFlags();
        } else if (doc.status === 'REJECTED') {
          const reasons = doc.rejectionDetails?.map(r => `• ${r.message}`).join('\n') ?? doc.rejectionReason ?? 'Unknown reason';
          Alert.alert('Document Rejected', `Your document was not accepted:\n\n${reasons}\n\nTap "Resubmit" to try again.`);
        }
        await loadStatus();
      } else {
        throw new Error('Upload confirmation failed');
      }
    } catch (err: any) {
      Alert.alert('Upload Failed', err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const handleResubmit = (doc: VerificationDoc) => {
    Alert.alert(
      'Resubmit Document',
      `Tap Upload to select a new file for ${TYPE_INFO[doc.verificationType].label}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upload New File', onPress: () => handleUpload(doc.verificationType) },
      ]
    );
  };

  const getDocForType = (type: DocVerificationType): VerificationDoc | undefined =>
    statusData?.verifications[type];

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.icon} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Verification Status</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#E74C3C" />
        </View>
      </SafeAreaView>
    );
  }

  const overallStatus = statusData?.overallStatus ?? 'UNVERIFIED';
  const overallConfig = {
    FULLY_VERIFIED: { color: '#2ECC71', label: 'Fully Verified', icon: 'shield-checkmark' as const },
    PARTIALLY_VERIFIED: { color: '#F39C12', label: 'Verification In Progress', icon: 'shield-half' as const },
    UNVERIFIED: { color: '#BDC3C7', label: 'Verification Required', icon: 'shield-outline' as const },
  }[overallStatus];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Verification Status</Text>
        <TouchableOpacity onPress={loadStatus} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={colors.icon} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Overall status banner */}
        <View style={[styles.overallCard, { backgroundColor: colors.card, borderColor: overallConfig.color }]}>
          <Ionicons name={overallConfig.icon} size={40} color={overallConfig.color} />
          <View style={styles.overallText}>
            <Text style={[styles.overallLabel, { color: overallConfig.color }]}>{overallConfig.label}</Text>
            <Text style={[styles.overallSub, { color: colors.muted }]}>
              {overallStatus === 'FULLY_VERIFIED'
                ? 'All your documents are verified. You are eligible to donate!'
                : 'Complete the verifications below to become a fully verified donor.'}
            </Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#C0392B" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Verification cards */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Document Verification</Text>

          {visibleTypes.map((type, index) => {
            const doc = getDocForType(type);
            const status = doc?.status ?? 'NOT_SUBMITTED';
            const info = TYPE_INFO[type];

            return (
              <View key={type} style={[styles.docCard, { backgroundColor: colors.card }, index < visibleTypes.length - 1 && styles.docCardBorder, index < visibleTypes.length - 1 && { borderBottomColor: colors.border }]}>
                <VerificationBadge
                  type={type}
                  status={status}
                  rejectionDetails={doc?.rejectionDetails}
                  canResubmit={doc?.canResubmit}
                  onUpload={uploading ? undefined : () => handleUpload(type)}
                  onResubmit={doc ? () => handleResubmit(doc) : undefined}
                />
                <Text style={[styles.docDescription, { color: colors.muted }]}>{info.description}</Text>

                {uploading === type && (
                  <View style={styles.uploadingRow}>
                    <ActivityIndicator size="small" color="#E74C3C" />
                    <Text style={styles.uploadingText}>Uploading & verifying...</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Guidelines */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Upload Guidelines</Text>
          <View style={[styles.guideCard, { backgroundColor: colors.card }]}>
            {[
              'Use good lighting — natural daylight is best',
              'Place document on a flat, dark surface',
              'Ensure all corners of the document are visible',
              'Avoid shadows, glare, and reflections',
              'Image must be at least 100 KB and under 5 MB',
              'Accepted formats: JPG, PNG, PDF',
            ].map((tip, i) => (
              <View key={i} style={styles.guideRow}>
                <Ionicons name="checkmark-circle" size={14} color="#2ECC71" style={styles.guideIcon} />
                <Text style={[styles.guideText, { color: colors.text }]}>{tip}</Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
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
  backBtn: { padding: 5 },
  refreshBtn: { padding: 5 },
  headerTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    color: '#333',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  overallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  overallText: { flex: 1, marginLeft: 16 },
  overallLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
  },
  overallSub: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDEDEC',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#C0392B',
    flex: 1,
  },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: '#222',
    marginBottom: 12,
  },
  docCard: {
    backgroundColor: '#fff',
    borderRadius: 0,
    overflow: 'hidden',
  },
  docCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  docDescription: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 16,
    paddingBottom: 12,
    lineHeight: 18,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  uploadingText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#E74C3C',
  },
  guideCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  guideIcon: { marginRight: 10, marginTop: 1 },
  guideText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#444',
    flex: 1,
    lineHeight: 20,
  },
});
