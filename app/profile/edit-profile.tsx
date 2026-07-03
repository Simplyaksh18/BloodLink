import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { userStorage } from '../../services/apiClient';
import { authService } from '../../services/authService';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export default function EditProfileScreen() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [bloodGroup, setBloodGroup] = useState(user?.bloodGroup || '');
  const [medicalCert, setMedicalCert] = useState(user?.medicalCertificate || '');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async () => {
    setError('');
    setSuccess('');
    
    if (!name.trim()) {
      return setError('Name is required.');
    }

    setIsLoading(true);

    try {
      const updatedData = {
        name,
        email,
        bloodGroup: bloodGroup as any,
        location: user?.location || undefined,
        medicalCertificate: medicalCert
      };

      // Persist to backend first — this is the source of truth
      const res = await authService.updateProfile(updatedData);
      if (!res.success) {
        setError(res.message || 'Failed to update profile. Please try again.');
        return;
      }

      // FIX 3.1: The update response omits derived fields (livesSaved,
      // donationEligibility, donationHistory). Re-fetch the full profile from
      // /auth/me so the global store has complete, fresh data — never partial.
      let freshUser = res.data;
      const me = await authService.getProfile();
      if (me.success && me.data) freshUser = me.data;

      // Update global auth store so all screens reflect changes immediately
      setUser(freshUser);

      // Mirror to local SecureStore so offline reads are consistent
      await userStorage.set(freshUser);

      setSuccess('Profile updated successfully!');
      setTimeout(() => {
        router.back();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"} 
        style={styles.content}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {success ? <Text style={styles.successText}>{success}</Text> : null}

          <View style={styles.formGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={20} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter email address"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Blood Group</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="water-outline" size={20} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={bloodGroup}
                onChangeText={setBloodGroup}
                placeholder="e.g. A+, O-"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Medical Certificate</Text>
            {medicalCert ? (
              <View style={styles.certBox}>
                <Ionicons name="document-text" size={24} color={Colors.light.primary} />
                <Text style={styles.certText}>Certificate Uploaded</Text>
                <TouchableOpacity onPress={() => setMedicalCert('')}>
                  <Ionicons name="close-circle" size={24} color="#999" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.uploadBtn} 
                onPress={async () => {
                  try {
                    let result = await DocumentPicker.getDocumentAsync({
                      type: ['image/*', 'application/pdf'],
                      copyToCacheDirectory: true,
                    });
                    if (!result.canceled && result.assets && result.assets.length > 0) {
                      setMedicalCert(result.assets[0].uri);
                    }
                  } catch (e) {
                    console.log('Document picker error:', e);
                  }
                }}
              >
                <Ionicons name="cloud-upload-outline" size={24} color={Colors.light.primary} />
                <Text style={styles.uploadBtnText}>Upload PDF or Image</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={[styles.btn, isLoading && styles.btnDisabled]} onPress={handleSave} disabled={isLoading}>
            <Text style={styles.btnText}>{isLoading ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  errorText: {
    fontFamily: 'Poppins_500Medium',
    color: Colors.light.tint,
    marginBottom: 15,
  },
  successText: {
    fontFamily: 'Poppins_500Medium',
    color: '#2ECC71',
    marginBottom: 15,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 12,
    height: 55,
    paddingHorizontal: 15,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: '#333',
    height: '100%',
  },
  btn: {
    backgroundColor: Colors.light.primary,
    height: 55,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    elevation: 3,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#fff',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.primary,
    borderRadius: 12,
    paddingVertical: 15,
    backgroundColor: 'rgba(231, 76, 60, 0.05)',
  },
  uploadBtnText: {
    fontFamily: 'Poppins_500Medium',
    color: Colors.light.primary,
    marginLeft: 10,
    fontSize: 15,
  },
  certBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 12,
    padding: 15,
  },
  certText: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: '#333',
    marginLeft: 10,
  },
});
