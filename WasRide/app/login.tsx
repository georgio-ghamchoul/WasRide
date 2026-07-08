import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, Modal, Pressable, Linking, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { sendWhatsappOtp, verifyWhatsappOtp } from '@/lib/whatsapp-otp';
import { useAppState } from '@/lib/app-state';

export default function LoginScreen() {
  const router = useRouter();
  const { locale, setLocale, darkMode, setDarkMode, setIsAdmin } = useAppState();
  const ar = locale === 'ar';

  const bg           = darkMode ? '#111827' : '#fff';
  const textColor    = darkMode ? '#fff'    : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#888';
  const inputBg      = darkMode ? '#1F2937' : '#fafafa';
  const borderColor  = darkMode ? '#374151' : '#ddd';

  const [step, setStep]         = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone]       = useState('');
  const [otp, setOtp]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const otpInputRef = useRef<TextInput | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendTimer <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setResendTimer((t) => t - 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [resendTimer]);

  // ── OTP ───────────────────────────────────────────────────────────────────

  function handleOtpChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setOtp(digits);
    if (digits.length === 4) handleVerifyOtp(digits);
  }

  async function handleSendOtp() {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 8)
      return Alert.alert('Error', 'Phone number must be exactly 8 digits');
    setLoading(true);
    // OTP is delivered over WhatsApp via SendZen + Supabase Edge Functions.
    try {
      await sendWhatsappOtp('+961' + cleaned);
      setOtp('');
      setStep('otp');
      setResendTimer(60);
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not send the code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    const cleaned = phone.replace(/\D/g, '');
    setLoading(true);
    try {
      await sendWhatsappOtp('+961' + cleaned);
      setOtp('');
      setResendTimer(60);
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not send the code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(code?: string) {
    const token   = code ?? otp;
    const cleaned = phone.replace(/\D/g, '');
    if (token.length < 4) return Alert.alert('Error', 'Enter the 4-digit code');
    if (!cleaned) { setStep('phone'); return; }
    setLoading(true);
    try {
      await verifyWhatsappOtp('+961' + cleaned, token);
      if (cleaned.endsWith('71073230')) setIsAdmin(true);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Incorrect or expired code', [
        { text: 'Try Again', style: 'cancel' },
        { text: 'Resend Code', onPress: handleResendOtp },
      ]);
      setOtp('');
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } finally {
      setLoading(false);
    }
  }

  // ── Menu ─────────────────────────────────────────────────────────────────

  function MenuOverlay() {
    return (
      <Modal visible={showMenu} transparent animationType="fade">
        <Pressable style={styles.menuBackdrop} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuCard, { backgroundColor: darkMode ? '#1F2937' : '#fff' }]}>

            <View style={styles.menuHeader}>
              <Text style={[styles.menuTitle, { color: textColor }]}>Menu</Text>
              <Pressable onPress={() => setShowMenu(false)} style={styles.menuCloseBtn}>
                <Text style={{ color: subtextColor, fontSize: 18, fontWeight: '700' }}>X</Text>
              </Pressable>
            </View>

            <Text style={[styles.menuSection, { color: subtextColor }]}>Language</Text>
            <View style={styles.menuToggleRow}>
              {(['en', 'ar'] as const).map((lang) => (
                <Pressable
                  key={lang}
                  onPress={() => { setLocale(lang); setShowMenu(false); }}
                  style={[styles.menuToggleBtn, { borderColor }, locale === lang && styles.menuToggleActive]}
                >
                  <Text style={[styles.menuToggleText, { color: locale === lang ? '#111827' : textColor }]}>
                    {lang === 'en' ? 'English' : 'Arabic'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.menuSection, { color: subtextColor }]}>Theme</Text>
            <View style={styles.menuToggleRow}>
              {([false, true] as const).map((dark) => (
                <Pressable
                  key={String(dark)}
                  onPress={() => { setDarkMode(dark); setShowMenu(false); }}
                  style={[styles.menuToggleBtn, { borderColor }, darkMode === dark && styles.menuToggleActive]}
                >
                  <Text style={[styles.menuToggleText, { color: darkMode === dark ? '#111827' : textColor }]}>
                    {dark ? 'Dark' : 'Light'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.menuSection, { color: subtextColor }]}>Support</Text>
            <Pressable
              onPress={() => { setShowMenu(false); Linking.openURL('https://wa.me/96171073230'); }}
              style={[styles.menuSupportBtn, { backgroundColor: '#16A34A' }]}
            >
              <Text style={styles.menuSupportText}>Contact Support</Text>
            </Pressable>

          </View>
        </Pressable>
      </Modal>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <MenuOverlay />

      <TouchableOpacity style={styles.menuBtn} onPress={() => setShowMenu(true)} activeOpacity={0.7}>
        <Text style={[styles.menuBtnText, { color: textColor }]}>= = =</Text>
      </TouchableOpacity>

      <View style={styles.content}>

        <View style={styles.logoWrap}>
          <View style={[styles.logoCircle, { backgroundColor: '#F4B400' }]}>
            <Text style={styles.logoIcon}>🏍️</Text>
          </View>
          <Text style={[styles.appName, { color: textColor }]}>Wasl</Text>
          <Text style={[styles.subtitle, { color: subtextColor }]}>
            {step === 'phone'
              ? 'Sign in with your phone number'
              : ('Code sent to +961' + phone.replace(/\D/g, ''))}
          </Text>
        </View>

        {step === 'phone' ? (
          <>
            <View style={[styles.phoneRow, { backgroundColor: inputBg, borderColor }]}>
              <Text style={[styles.prefix, { color: textColor }]}>+961</Text>
              <TextInput
                style={[styles.phoneInput, { color: textColor }]}
                placeholder="Phone number"
                placeholderTextColor={subtextColor}
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
                keyboardType="phone-pad"
                maxLength={8}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={handleSendOtp}
              disabled={loading}
            >
              <Text style={styles.primaryBtnText}>
                {loading ? 'Sending...' : 'Send Code'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.driverBtn, { borderColor: '#F4B400' }]}
              onPress={() => router.push('/driver-apply' as never)}
              activeOpacity={0.8}
            >
              <Text style={styles.driverBtnText}>🏍️  Become a Driver</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Pressable onPress={() => otpInputRef.current?.focus()} style={styles.otpRow}>
              {Array.from({ length: 4 }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.otpBox, {
                    backgroundColor: inputBg,
                    borderColor: otp[i] ? '#F4B400' : borderColor,
                  }]}
                >
                  <Text style={[styles.otpDigitText, { color: textColor }]}>
                    {otp[i] ?? ''}
                  </Text>
                </View>
              ))}
              <TextInput
                ref={otpInputRef}
                value={otp}
                onChangeText={handleOtpChange}
                keyboardType="number-pad"
                maxLength={4}
                style={styles.otpHiddenInput}
                caretHidden
              />
            </Pressable>

            <Text style={[styles.changeLink, { color: subtextColor, textAlign: 'center', marginTop: 4 }]}>
              The code can take up to a minute to arrive.
            </Text>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={() => handleVerifyOtp()}
              disabled={loading}
            >
              <Text style={styles.primaryBtnText}>
                {loading ? 'Verifying...' : 'Verify'}
              </Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center', marginTop: 12 }}>
              {resendTimer > 0 ? (
                <Text style={[styles.changeLink, { color: subtextColor }]}>
                  {'Resend in ' + resendTimer + 's'}
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResendOtp} disabled={loading}>
                  <Text style={[styles.changeLink, { color: '#F4B400', textDecorationLine: 'underline' }]}>
                    Resend Code
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              onPress={() => { setStep('phone'); setOtp(''); setResendTimer(0); }}
              style={{ marginTop: 10, alignItems: 'center' }}
            >
              <Text style={[styles.changeLink, { color: subtextColor }]}>
                Change phone number
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        style={styles.helpBtn}
        onPress={() => {
          if (step === 'otp') {
            setStep('phone');
            setOtp('');
            setResendTimer(0);
          } else {
            Alert.alert(
              'Need Help?',
              "Didn't receive the code? Check your number and wait a minute, then try again.",
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'WhatsApp', onPress: () => Linking.openURL('https://wa.me/96171073230') },
              ]
            );
          }
        }}
      >
        <Text style={[styles.helpText, { color: step === 'otp' ? '#F4B400' : subtextColor }]}>
          {step === 'otp' ? 'Change phone number' : 'Need help logging in?'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  menuBtn: { position: 'absolute', top: 52, left: 20, zIndex: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuBtnText: { fontSize: 16, fontWeight: '900', letterSpacing: 2 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: 20 },
  logoWrap:   { alignItems: 'center', marginBottom: 36 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: '#F4B400', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
  logoIcon:   { fontSize: 34 },
  appName:    { fontSize: 28, fontWeight: '900', letterSpacing: 0.5, marginBottom: 6 },
  subtitle:   { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  phoneRow:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 16, height: 58, width: '100%', marginBottom: 14 },
  prefix:     { fontSize: 16, fontWeight: '700', marginRight: 10 },
  phoneInput: { flex: 1, fontSize: 17, height: '100%' },
  primaryBtn:     { backgroundColor: '#F4B400', padding: 18, borderRadius: 16, alignItems: 'center', width: '100%', marginBottom: 14, shadowColor: '#F4B400', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  primaryBtnText: { fontSize: 17, fontWeight: '900', color: '#111827' },
  driverBtn:      { width: '100%', paddingVertical: 16, borderRadius: 16, borderWidth: 2, alignItems: 'center' },
  driverBtnText:  { fontSize: 16, fontWeight: '800', color: '#F4B400' },
  otpRow:         { flexDirection: 'row', gap: 10, marginBottom: 20, justifyContent: 'center', position: 'relative' },
  otpBox:         { width: 46, height: 58, borderWidth: 2, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  otpDigitText:   { fontSize: 22, fontWeight: '900' },
  otpHiddenInput: { position: 'absolute', width: '100%', height: '100%', opacity: 0 },
  changeLink:     { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  helpBtn:        { alignItems: 'center', paddingBottom: 28, paddingTop: 8 },
  helpText:       { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  menuBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', paddingTop: 80, paddingLeft: 16 },
  menuCard:       { width: 260, borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  menuHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  menuTitle:      { fontSize: 17, fontWeight: '900' },
  menuCloseBtn:   { padding: 4 },
  menuSection:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  menuToggleRow:  { flexDirection: 'row', gap: 8, marginBottom: 16 },
  menuToggleBtn:  { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  menuToggleActive: { backgroundColor: '#F4B400', borderColor: '#F4B400' },
  menuToggleText:   { fontSize: 13, fontWeight: '700' },
  menuSupportBtn:   { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  menuSupportText:  { color: '#fff', fontWeight: '800', fontSize: 14 },
});
