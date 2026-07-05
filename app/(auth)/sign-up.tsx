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
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';

type SelectedRole = 'USER' | 'BLOOD_BANK';

export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<SelectedRole>('USER');
  const [roleStep, setRoleStep] = useState(false);

  // OTP step state
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');

  const router = useRouter();
  const { colors } = useTheme();
  const setToken = useAuthStore((state) => state.setToken);
  const setUser = useAuthStore((state) => state.setUser);

  // Step 1: validate fields → show role selection step
  const handleSignUp = async () => {
    setError('');
    if (!name.trim()) return setError('Full Name is required.');
    if (!phone.trim()) return setError('Mobile Number is required.');
    if (phone.length < 10) return setError('Please enter a valid mobile number.');
    if (!password) return setError('Password is required.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setRoleStep(true);
  };

  // Step 2: role chosen → send OTP
  const handleRoleConfirm = async () => {
    setLoading(true);
    try {
      const res = await authService.sendOtp({ phone: `+91${phone}` });
      if (res.success) {
        if (res.data?.otp) setOtp(res.data.otp);
        setOtpError('');
        console.log('[OTP] backend send code');
        setRoleStep(false);
        setOtpStep(true);
        console.log('[OTP] autofill-ready input shown');
      } else {
        setError(res.message || 'Failed to send OTP. Please try again.');
        setRoleStep(false);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to send OTP.');
      setRoleStep(false);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    if (!otp || otp.length !== 6) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }

    console.log('[SignUpOTP] verify pressed phone:', `+91${phone}`);
    console.log('[SignUpOTP] otp length:', otp.length);

    setOtpLoading(true);
    try {
      const verifyRes = await authService.verifyOtp({ phone: `+91${phone}`, otp });
      if (!verifyRes.success || !verifyRes.data?.verificationToken) {
        setOtpError(verifyRes.message || 'OTP verification failed.');
        setOtpLoading(false);
        return;
      }

      const token = verifyRes.data.verificationToken;
      console.log('[SignUpOTP] verify success: token received');
      setVerificationToken(token);

      console.log('[SignUpOTP] register starting after verify');
      console.log('[SignUpOTP] register payload phone:', `+91${phone}`);

      const registerRes = await authService.register({
        name,
        phone: `+91${phone}`,
        email: email || undefined,
        password,
        verificationToken: token,
        role: selectedRole,
      });

      if (registerRes.success && registerRes.data) {
        console.log('[SignUpOTP] register success');
        setOtpStep(false);
        setToken(registerRes.data.token, registerRes.data.refreshToken);
        setUser(registerRes.data.user);
        const registeredRole = registerRes.data.user?.role;
        console.log('[AuthRole] register payload role:', selectedRole);
        console.log('[AuthRole] stored role:', registeredRole);
        router.replace(registeredRole === 'BLOOD_BANK' ? '/(tabs)/blood-bank-dashboard' : '/(tabs)');
      } else {
        console.log('[SignUpOTP] register failed:', registerRes.message);
        setOtpError(registerRes.message || 'Registration failed.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'OTP verification failed.';
      console.log('[SignUpOTP] register failed:', msg);
      setOtpError(msg);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpError('');
    try {
      const res = await authService.sendOtp({ phone: `+91${phone}` });
      if (res.data?.otp) setOtp(res.data.otp);
      console.log('[OTP] backend send code');
    } catch (err: any) {
      setOtpError(err?.response?.data?.message ?? err?.message ?? 'Failed to resend OTP.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Ionicons name="water" size={50} color="#fff" />
            </View>
            <Text style={[styles.appName, { color: colors.text }]}>BloodLink</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Create your account.</Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.title, { color: colors.text }]}>Sign Up</Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={[styles.label, { color: colors.text }]}>Full Name *</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="John Doe"
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
              />
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Mobile Number *</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.countryCodeBox, { backgroundColor: colors.border }]}>
                <Text style={[styles.countryCode, { color: colors.text }]}>+91</Text>
              </View>
              <TextInput
                style={[styles.inputWithCode, { color: colors.text }]}
                placeholder="98XXXXXXXX"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                maxLength={10}
              />
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Email (Optional)</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="john@example.com"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Password *</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Minimum 8 characters"
                placeholderTextColor={colors.muted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Text style={[styles.label, { color: colors.text }]}>Confirm Password *</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Re-enter password"
                placeholderTextColor={colors.muted}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleSignUp}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.muted }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')}>
                <Text style={styles.linkText}>Sign in now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Role Selection Modal ── */}
      <Modal visible={roleStep} transparent animationType="slide" onRequestClose={() => setRoleStep(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>I am a...</Text>
            <Text style={[styles.modalSubtitle, { color: colors.muted }]}>Choose your role. This helps us personalise your experience.</Text>

            <TouchableOpacity
              style={[styles.roleCard, { backgroundColor: colors.surface, borderColor: colors.border }, selectedRole === 'USER' && styles.roleCardActive]}
              onPress={() => setSelectedRole('USER')}
              activeOpacity={0.8}
            >
              <Text style={styles.roleEmoji}>🩸</Text>
              <View style={styles.roleCardInfo}>
                <Text style={[styles.roleCardTitle, { color: colors.text }, selectedRole === 'USER' && styles.roleCardTitleActive]}>Donor / Recipient</Text>
                <Text style={[styles.roleCardSub, { color: colors.muted }]}>Donate blood or request blood during emergencies</Text>
              </View>
              {selectedRole === 'USER' && <Ionicons name="checkmark-circle" size={22} color={Colors.light.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleCard, { backgroundColor: colors.surface, borderColor: colors.border }, selectedRole === 'BLOOD_BANK' && styles.roleCardActive]}
              onPress={() => setSelectedRole('BLOOD_BANK')}
              activeOpacity={0.8}
            >
              <Text style={styles.roleEmoji}>🏥</Text>
              <View style={styles.roleCardInfo}>
                <Text style={[styles.roleCardTitle, { color: colors.text }, selectedRole === 'BLOOD_BANK' && styles.roleCardTitleActive]}>Blood Bank</Text>
                <Text style={[styles.roleCardSub, { color: colors.muted }]}>Manage your blood bank, inventory and incoming requests</Text>
              </View>
              {selectedRole === 'BLOOD_BANK' && <Ionicons name="checkmark-circle" size={22} color={Colors.light.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleRoleConfirm}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRoleStep(false)}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── OTP Verification Modal ── */}
      <Modal visible={otpStep} transparent animationType="slide" onRequestClose={() => setOtpStep(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Verify Phone</Text>
            <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
              Enter the 6-digit OTP sent to +91 {phone}
            </Text>

            {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

            <View style={[styles.inputWrapper, { marginTop: 16, backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, styles.otpInput, { color: colors.text }]}
                placeholder="6-digit OTP"
                placeholderTextColor={colors.muted}
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
              style={[styles.btn, otpLoading && styles.btnDisabled]}
              onPress={handleVerifyOtp}
              activeOpacity={0.8}
              disabled={otpLoading}
            >
              {otpLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Verify & Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.otpFooter}>
              <Text style={[styles.footerText, { color: colors.muted }]}>Didn't receive OTP? </Text>
              <TouchableOpacity onPress={handleResendOtp}>
                <Text style={styles.linkText}>Resend</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setOtpStep(false)}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>← Change number</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 30,
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    marginBottom: 15,
  },
  appName: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 28,
    color: '#333',
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 16,
    color: '#666',
  },
  formCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 25,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#222',
    marginBottom: 20,
  },
  errorText: {
    fontFamily: 'Poppins_500Medium',
    color: Colors.light.tint,
    marginBottom: 15,
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
    marginBottom: 15,
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
    marginTop: 15,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  footerText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#666',
  },
  linkText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: Colors.light.primary,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  modalTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#222',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  otpInput: {
    letterSpacing: 6,
    fontSize: 22,
    textAlign: 'center',
  },
  otpFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  cancelBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#999',
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    gap: 12,
    backgroundColor: '#FAFAFA',
  },
  roleCardActive: {
    borderColor: Colors.light.primary,
    backgroundColor: 'rgba(231,76,60,0.04)',
  },
  roleEmoji: {
    fontSize: 28,
  },
  roleCardInfo: {
    flex: 1,
  },
  roleCardTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#333',
  },
  roleCardTitleActive: {
    color: Colors.light.primary,
  },
  roleCardSub: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
});
