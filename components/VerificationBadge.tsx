import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DocVerificationStatus, DocVerificationType, RejectionDetail } from '../services/verificationService';

const TYPE_LABELS: Record<DocVerificationType, string> = {
  ID_PROOF: 'ID Proof',
  BLOOD_GROUP_PROOF: 'Blood Group Certificate',
  MEDICAL_SCREENING: 'Medical Screening',
  LICENSE: 'Blood Bank License',
};

interface BadgeConfig {
  bg: string;
  text: string;
  textColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}

function getBadgeConfig(status: DocVerificationStatus): BadgeConfig {
  switch (status) {
    case 'VERIFIED':
      return { bg: '#E8F8EF', text: 'Verified', textColor: '#1A8A48', icon: 'checkmark-circle', iconColor: '#2ECC71' };
    case 'REJECTED':
      return { bg: '#FDEDEC', text: 'Rejected', textColor: '#C0392B', icon: 'close-circle', iconColor: '#E74C3C' };
    case 'UPLOADED':
      return { bg: '#FEF9E7', text: 'Processing...', textColor: '#D68910', icon: 'time', iconColor: '#F39C12' };
    case 'AUTO_VERIFICATION_PASSED':
    case 'PENDING_REVIEW':
      return { bg: '#EBF5FB', text: 'Under Review', textColor: '#1A5276', icon: 'information-circle', iconColor: '#2980B9' };
    case 'AUTO_VERIFICATION_FAILED':
      return { bg: '#FDEDEC', text: 'Failed', textColor: '#C0392B', icon: 'close-circle', iconColor: '#E74C3C' };
    case 'EXPIRED':
      return { bg: '#F2F3F4', text: 'Expired', textColor: '#7F8C8D', icon: 'warning', iconColor: '#95A5A6' };
    case 'NOT_SUBMITTED':
    default:
      return { bg: '#F2F3F4', text: 'Not Submitted', textColor: '#7F8C8D', icon: 'remove-circle-outline', iconColor: '#BDC3C7' };
  }
}

interface Props {
  type: DocVerificationType;
  status: DocVerificationStatus;
  rejectionDetails?: RejectionDetail[];
  canResubmit?: boolean;
  onUpload?: () => void;
  onResubmit?: () => void;
}

export default function VerificationBadge({ type, status, rejectionDetails, canResubmit, onUpload, onResubmit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = getBadgeConfig(status);
  const isRejected = status === 'REJECTED' || status === 'AUTO_VERIFICATION_FAILED';
  const isNotSubmitted = status === 'NOT_SUBMITTED';
  const isExpired = status === 'EXPIRED';
  const showDetails = isRejected && rejectionDetails && rejectionDetails.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.labelCol}>
          <Text style={styles.typeLabel}>{TYPE_LABELS[type]}</Text>
        </View>

        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <Ionicons name={config.icon} size={14} color={config.iconColor} />
          <Text style={[styles.badgeText, { color: config.textColor }]}>{config.text}</Text>
        </View>

        {(isNotSubmitted || isExpired) && onUpload && (
          <TouchableOpacity style={styles.actionBtn} onPress={onUpload}>
            <Text style={styles.actionBtnText}>{isExpired ? 'Renew' : 'Upload'}</Text>
          </TouchableOpacity>
        )}

        {isRejected && onResubmit && (
          <TouchableOpacity style={[styles.actionBtn, styles.resubmitBtn]} onPress={onResubmit}>
            <Text style={[styles.actionBtnText, { color: '#E74C3C' }]}>Resubmit</Text>
          </TouchableOpacity>
        )}

        {showDetails && (
          <TouchableOpacity onPress={() => setExpanded(e => !e)} style={styles.chevron}>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {expanded && showDetails && (
        <View style={styles.rejectionBox}>
          {rejectionDetails!.map((r, i) => (
            <View key={i} style={styles.rejectionItem}>
              <Text style={styles.rejectionMsg}>{r.message}</Text>
              {r.suggestion ? (
                <Text style={styles.rejectionSuggestion}>{r.suggestion}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  labelCol: {
    flex: 1,
  },
  typeLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#333',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
    marginLeft: 8,
  },
  badgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },
  actionBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#E8F4FD',
  },
  resubmitBtn: {
    backgroundColor: '#FDEDEC',
  },
  actionBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: '#2980B9',
  },
  chevron: {
    padding: 4,
    marginLeft: 4,
  },
  rejectionBox: {
    backgroundColor: '#FFF5F5',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#E74C3C',
  },
  rejectionItem: {
    marginBottom: 8,
  },
  rejectionMsg: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#C0392B',
  },
  rejectionSuggestion: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
});
