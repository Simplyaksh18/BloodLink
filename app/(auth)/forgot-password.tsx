import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authService } from '../../services/authService';

type Step = 'phone' | 'otp' | 'reset';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = async () => {
    setError('');
    if (!phone.trim() || phone.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      const res = await authService.forgotPassword(`+91${phone}`);
      if (res.success) {
        if (res.data?.otp) setOtp(res.data.otp);
        console.log('[OTP] backend send code');
        setStep('otp');
        console.log('[OTP] autofill-ready input shown');
      } else {
        setError(res.message || 'Could not send OTP. Is this number registered?');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = () => {
    setError('');
    if (!otp || otp.length !== 6) return setError('Please enter the 6-digit OTP.');
    setNewPassword('');
    setConfirmPassword('');
    setStep('reset');
  };

  const handleReset = async () => {
    setError('');
    if (!newPassword || newPassword.length < 8) return setError('Password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');

    setLoading(true);
    try {
      const res = await authService.resetPassword(`+91${phone}`, otp, newPassword);
      if (res.success) {
        console.log('[OTP] backend verify success');
        router.replace('/(auth)/sign-in');
      } else {
        setError(res.message || 'Password reset failed. Please try again.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  const title =
    step === 'phone' ? 'Forgot Password?' :
    step === 'otp'   ? 'Verify Phone' :
    'Reset Password';

  const subtitle =
    step === 'phone'
      ? "Enter your registered mobile number and we'll send you a verification code."
      : step === 'otp'
        ? `Enter the verification code sent to +91 ${phone}`
        : 'Enter your new password to complete the reset.';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.icon} />
          </TouchableOpacity>

          <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="lock-closed-outline" size={48} color={Colors.light.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {step === 'phone' && (
            <>
              <Text style={[styles.label, { color: colors.text }]}>Mobile Number</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                <View style={[styles.countryCodeBox, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
                  <Text style={[styles.countryCode, { color: colors.text }]}>+91</Text>
                </View>
                <TextInput
                  style={[styles.inputWithCode, { color: colors.inputText }]}
                  placeholder="98XXXXXXXX"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  maxLength={10}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleSendOtp}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Code</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={[styles.label, { color: colors.text }]}>Verification Code</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.input, styles.otpInput, { color: colors.inputText }]}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={setOtp}
                  autoFocus
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  importantForAutofill="yes"
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify Code</Text>}
              </TouchableOpacity>

              <View style={styles.resendRow}>
                <Text style={[styles.resendLabel, { color: colors.muted }]}>Didn't receive code? </Text>
                <TouchableOpacity onPress={() => { setStep('phone'); setError(''); }}>
                  <Text style={styles.resendLink}>Try again</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 'reset' && (
            <>
              <Text style={[styles.label, { color: colors.text }]}>New Password</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.input, { color: colors.inputText }]}
                  placeholder="Minimum 8 characters"
                  placeholderTextColor={colors.inputPlaceholder}
                  secureTextEntry
                  value={newPassword}
                  onChangeText={setNewPassword}
                  autoFocus
                />
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Confirm New Password</Text>
              <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.input, { color: colors.inputText }]}
                  placeholder="Re-enter new password"
                  placeholderTextColor={colors.inputPlaceholder}
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleReset}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.signInLink} onPress={() => router.replace('/(auth)/sign-in')}>
            <Text style={[styles.signInLinkText, { color: colors.muted }]}>← Back to Sign In</Text>
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexGrow: 1,
  },
  backBtn: {
    marginBottom: 20,
    padding: 4,
    alignSelf: 'flex-start',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 26,
    color: '#222',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  errorText: {
    fontFamily: 'Poppins_500Medium',
    color: Colors.light.tint,
    marginBottom: 15,
    textAlign: 'center',
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
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 14,
    backgroundColor: '#FAFAFA',
    height: 55,
    marginBottom: 18,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: '#333',
    paddingHorizontal: 15,
    height: '100%',
  },
  otpInput: {
    letterSpacing: 6,
    fontSize: 22,
    textAlign: 'center',
  },
  countryCodeBox: {
    paddingHorizontal: 15,
    height: '100%',
    justifyContent: 'center',
    backgroundColor: '#F0F0F0',
    borderRightWidth: 1,
    borderRightColor: '#E8E8E8',
  },
  countryCode: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#333',
  },
  inputWithCode: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: '#333',
    paddingHorizontal: 15,
    height: '100%',
  },
  btn: {
    backgroundColor: Colors.light.primary,
    height: 55,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
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
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  resendLabel: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#666',
  },
  resendLink: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: Colors.light.primary,
  },
  signInLink: {
    marginTop: 32,
    alignItems: 'center',
  },
  signInLinkText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#888',
  },
});
