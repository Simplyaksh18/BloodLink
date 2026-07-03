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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/Colors';
import { useTheme } from '../../context/ThemeContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';

export default function SignInScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // OTP login modal state
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
  const [otpPhone, setOtpPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpSuccess, setOtpSuccess] = useState('');
  const [otpVerificationToken, setOtpVerificationToken] = useState('');

  const router = useRouter();
  const { colors } = useTheme();
  const setToken = useAuthStore((state) => state.setToken);
  const setUser = useAuthStore((state) => state.setUser);

  const handleSignIn = async () => {
    setError('');

    if (!phone.trim()) return setError('Mobile Number is required.');
    if (phone.length < 10) return setError('Please enter a valid mobile number.');
    if (!password) return setError('Password is required.');

    setLoading(true);
    try {
      const res = await authService.loginWithPassword({
        phone: `+91${phone}`,
        password,
      });

      if (res.success && res.data) {
        setToken(res.data.token, res.data.refreshToken);
        setUser(res.data.user);
        const role = res.data.user?.role;
        console.log('[AuthRole] login stored role:', role);
        router.replace(
          role === 'SUPER_ADMIN' || role === 'ADMIN'
            ? '/(admin)/dashboard'
            : role === 'BLOOD_BANK'
              ? '/(tabs)/blood-bank-dashboard'
              : '/(tabs)'
        );
      } else {
        setError(res.message || 'Invalid credentials.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'An error occurred during sign in.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const openOtpModal = () => {
    setOtpPhone('');
    setOtp('');
    setOtpError('');
    setOtpSuccess('');
    setOtpVerificationToken('');
    setOtpStep('phone');
    setOtpModalVisible(true);
  };

  const handleSendOtp = async () => {
    setOtpError('');
    if (!otpPhone.trim() || otpPhone.length < 10) {
      setOtpError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await authService.sendOtp({ phone: `+91${otpPhone}` });
      if (res.success) {
        if (res.data?.otp) setOtp(res.data.otp);
        console.log('[OTP] backend send code');
        setOtpStep('otp');
        console.log('[OTP] autofill-ready input shown');
      } else {
        setOtpError(res.message || 'Failed to send OTP. Please try again.');
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message ?? err?.message ?? 'Failed to send OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    if (!otp || otp.length !== 6) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await authService.verifyOtp({ phone: `+91${otpPhone}`, otp });
      if (!res.success) {
        setOtpError(res.message || 'OTP verification failed.');
        setOtpLoading(false);
        return;
      }

      const verificationToken = res.data?.verificationToken ?? '';
      console.log('[OTPLoginUI] verificationToken present:', !!verificationToken);

      if (res.data?.isNewUser) {
        setOtpModalVisible(false);
        router.push({ pathname: '/(auth)/sign-up', params: { phone: otpPhone, verificationToken } } as any);
        return;
      }

      setOtpVerificationToken(verificationToken);
      console.log('[OTPLoginUI] otpLogin starting:', `+91${otpPhone}`);
      const loginRes = await authService.otpLogin(`+91${otpPhone}`, verificationToken);
      if (loginRes.success && loginRes.data) {
        console.log('[OTPLoginUI] otpLogin success: true');
        console.log('[OTP] backend verify success');
        setOtpModalVisible(false);
        setToken(loginRes.data.token, loginRes.data.refreshToken);
        setUser(loginRes.data.user);
        const role = loginRes.data.user?.role;
        console.log('[AuthRole] otp login stored role:', role);
        router.replace(
          role === 'SUPER_ADMIN' || role === 'ADMIN'
            ? '/(admin)/dashboard'
            : role === 'BLOOD_BANK'
              ? '/(tabs)/blood-bank-dashboard'
              : '/(tabs)'
        );
      } else {
        console.log('[OTPLoginUI] otpLogin failed:', loginRes.message);
        setOtpError(loginRes.message || 'Login failed. Please try again.');
      }
    } catch (err: any) {
      setOtpError(err?.response?.data?.message ?? err?.message ?? 'OTP verification failed.');
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Ionicons name="water" size={50} color="#fff" />
            </View>
            <Text style={[styles.appName, { color: colors.text }]}>BloodLink</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Welcome back!</Text>
          </View>

          <View style={[styles.formCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.title, { color: colors.text }]}>Sign In</Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {otpSuccess ? <Text style={styles.successText}>{otpSuccess}</Text> : null}

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
              />
            </View>

            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.text }]}>Password</Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.inputText }]}
                placeholder="Enter password"
                placeholderTextColor={colors.inputPlaceholder}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleSignIn}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.muted }]}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/sign-up')}>
                <Text style={styles.linkText}>Sign up now</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.muted }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <TouchableOpacity
              style={[styles.otpBtn, { borderColor: Colors.light.primary, backgroundColor: colors.card }]}
              onPress={openOtpModal}
              activeOpacity={0.8}
            >
              <Ionicons name="keypad-outline" size={18} color={Colors.light.primary} style={{ marginRight: 8 }} />
              <Text style={styles.otpBtnText}>Continue with OTP</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* OTP Login Modal */}
      <Modal visible={otpModalVisible} transparent animationType="slide" onRequestClose={() => setOtpModalVisible(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalKAV}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            {otpStep === 'phone' && (
              <>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Sign In with OTP</Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>Enter your registered mobile number to receive an OTP.</Text>

                {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

                <View style={[styles.inputWrapper, { marginTop: 16, backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                  <View style={[styles.countryCodeBox, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
                    <Text style={[styles.countryCode, { color: colors.text }]}>+91</Text>
                  </View>
                  <TextInput
                    style={[styles.inputWithCode, { color: colors.inputText }]}
                    placeholder="98XXXXXXXX"
                    placeholderTextColor={colors.inputPlaceholder}
                    keyboardType="phone-pad"
                    value={otpPhone}
                    onChangeText={setOtpPhone}
                    maxLength={10}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[styles.btn, otpLoading && styles.btnDisabled]}
                  onPress={handleSendOtp}
                  disabled={otpLoading}
                  activeOpacity={0.8}
                >
                  {otpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send OTP</Text>}
                </TouchableOpacity>
              </>
            )}

            {otpStep === 'otp' && (
              <>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Enter OTP</Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>OTP sent to +91 {otpPhone}</Text>

                {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

                <View style={[styles.inputWrapper, { marginTop: 16, backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.input, styles.otpInput, { color: colors.inputText }]}
                    placeholder="6-digit OTP"
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
                  style={[styles.btn, otpLoading && styles.btnDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={otpLoading}
                  activeOpacity={0.8}
                >
                  {otpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify OTP</Text>}
                </TouchableOpacity>

                <View style={styles.otpFooter}>
                  <Text style={[styles.footerText, { color: colors.muted }]}>Didn't receive OTP? </Text>
                  <TouchableOpacity onPress={handleSendOtp}>
                    <Text style={styles.linkText}>Resend</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setOtpModalVisible(false)}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>← Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
    marginBottom: 40,
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
  successText: {
    fontFamily: 'Poppins_500Medium',
    color: '#2ECC71',
    marginBottom: 15,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#555',
  },
  forgotText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: Colors.light.primary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 14,
    backgroundColor: '#FAFAFA',
    height: 55,
    marginBottom: 20,
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
    marginTop: 10,
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
    marginTop: 25,
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 15,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8E8E8',
  },
  dividerText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#999',
    marginHorizontal: 10,
  },
  otpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.light.primary,
    backgroundColor: '#fff',
  },
  otpBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: Colors.light.primary,
  },
  // Modal
  modalKAV: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 28,
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
    marginTop: 16,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#999',
  },
});
