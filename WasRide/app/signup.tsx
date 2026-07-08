import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { sendWhatsappOtp, verifyWhatsappOtp } from '@/lib/whatsapp-otp'
import { useRouter } from 'expo-router'
import { useAppState } from '@/lib/app-state'

type Step = 'phone' | 'otp' | 'info'

const RESEND_SECONDS = 30

export default function SignUpScreen() {
  const router = useRouter()
  const { locale, darkMode } = useAppState()
  const ar = locale === 'ar'

  const bg = darkMode ? '#111827' : '#fff'
  const textColor = darkMode ? '#fff' : '#111827'
  const subtextColor = darkMode ? '#9CA3AF' : '#888'
  const inputBg = darkMode ? '#1F2937' : '#fafafa'
  const borderColor = darkMode ? '#374151' : '#ddd'
  const cardBg = darkMode ? '#1E293B' : '#F9FAFB'

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)

  // Resend countdown
  const [resendTimer, setResendTimer] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // OTP input refs for auto-advance
  const otpRefs = useRef<(TextInput | null)[]>([])
  const [otpDigits, setOtpDigits] = useState(['', '', '', ''])

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function startResendTimer() {
    setResendTimer(RESEND_SECONDS)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSendOtp() {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length !== 8)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'رقم الهاتف يجب أن يكون 8 أرقام' : 'Phone number must be exactly 8 digits')
    setLoading(true)
    try {
      await sendWhatsappOtp(`+961${cleaned}`)
      setOtpDigits(['', '', '', ''])
      setOtp('')
      setStep('otp')
      startResendTimer()
      setTimeout(() => otpRefs.current[0]?.focus(), 300)
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message || 'Could not send the code.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendTimer > 0) return
    setLoading(true)
    const cleaned = phone.replace(/\D/g, '')
    try {
      await sendWhatsappOtp(`+961${cleaned}`)
      setOtpDigits(['', '', '', ''])
      setOtp('')
      startResendTimer()
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message || 'Could not send the code.')
    } finally {
      setLoading(false)
    }
  }

  function handleOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit
    setOtpDigits(next)
    const combined = next.join('')
    setOtp(combined)
    if (digit && index < 3) {
      otpRefs.current[index + 1]?.focus()
    }
    // Auto-submit when all 6 filled
    if (combined.length === 4) {
      handleVerifyOtp(combined)
    }
  }

  function handleOtpBackspace(index: number, key: string) {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      const next = [...otpDigits]
      next[index - 1] = ''
      setOtpDigits(next)
      setOtp(next.join(''))
      otpRefs.current[index - 1]?.focus()
    }
  }

  async function handleVerifyOtp(code?: string) {
    const token = code ?? otp
    if (token.length < 4)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'أدخل رمز التحقق كاملاً' : 'Enter the full 4-digit code')
    setLoading(true)
    const cleaned = phone.replace(/\D/g, '')
    try {
      await verifyWhatsappOtp(`+961${cleaned}`, token)
    } catch (e: any) {
      setLoading(false)
      Alert.alert(ar ? 'رمز خاطئ' : 'Invalid code', e.message || (ar ? 'الرمز غير صحيح أو انتهت صلاحيته' : 'Incorrect or expired code'))
      return
    }
    // We now have a session. If this number already has a profile, send them in.
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: existing } = await supabase
        .from('profiles').select('id').eq('id', user.id).maybeSingle()
      if (existing) {
        setLoading(false)
        Alert.alert(
          ar ? 'حساب موجود' : 'Account exists',
          ar ? 'هذا الرقم مسجّل بالفعل.' : 'This number already has an account.',
          [{ text: ar ? 'متابعة' : 'Continue', onPress: () => router.replace('/' as never) }]
        )
        return
      }
    }
    setLoading(false)
    setStep('info')
  }

  async function handleFinish() {
    if (!firstName.trim())
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'أدخل اسمك الأول' : 'Enter your first name')
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          phone: `+961${phone.replace(/\D/g, '')}`,
          full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          role: 'rider',
          approval_status: 'approved',
        }, { onConflict: 'id' })
      }
      router.replace('/' as never)
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  // Step indicator
  const steps: Step[] = ['phone', 'otp', 'info']
  const stepIndex = steps.indexOf(step)

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: bg }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo & title */}
        <Text style={styles.logo}>🚕</Text>
        <Text style={[styles.title, { color: textColor }]}>{ar ? 'إنشاء حساب' : 'Create Account'}</Text>

        {/* Step dots */}
        <View style={styles.dots}>
          {steps.map((_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i <= stepIndex ? '#F4B400' : (darkMode ? '#374151' : '#E5E7EB') }]} />
          ))}
        </View>

        {/* ── STEP 1: Phone ── */}
        {step === 'phone' && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: textColor }]}>
              {ar ? 'أدخل رقم هاتفك' : 'Enter your phone number'}
            </Text>
            <Text style={[styles.stepSub, { color: subtextColor }]}>
              {ar ? 'سنرسل لك رمز تحقق عبر الرسائل القصيرة' : "We'll send you a verification code via SMS"}
            </Text>

            <View style={[styles.phoneRow, { borderColor, backgroundColor: inputBg }]}>
              <View style={[styles.prefixBox, { backgroundColor: darkMode ? '#374151' : '#E5E7EB' }]}>
                <Text style={[styles.prefixText, { color: textColor }]}>🇱🇧 +961</Text>
              </View>
              <TextInput
                placeholder="12 345 678"
                placeholderTextColor={subtextColor}
                value={phone}
                onChangeText={t => setPhone(t.replace(/\D/g, ''))}
                keyboardType="phone-pad"
                maxLength={8}
                style={[styles.phoneInput, { color: textColor }]}
                autoFocus
              />
            </View>

            <TouchableOpacity style={styles.mainBtn} onPress={handleSendOtp} disabled={loading}>
              <Text style={styles.mainBtnText}>
                {loading ? (ar ? 'جارٍ الإرسال...' : 'Sending...') : (ar ? 'متابعة' : 'Continue')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP 2: OTP ── */}
        {step === 'otp' && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: textColor }]}>
              {ar ? 'أدخل رمز التحقق' : 'Enter verification code'}
            </Text>
            <Text style={[styles.stepSub, { color: subtextColor }]}>
              {ar ? `تم إرسال رمز إلى +961${phone}` : `Code sent to +961${phone}`}
            </Text>

            {/* 6-box OTP */}
            <View style={styles.otpRow}>
              {otpDigits.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={ref => { otpRefs.current[i] = ref }}
                  style={[
                    styles.otpBox,
                    {
                      backgroundColor: inputBg,
                      borderColor: digit ? '#F4B400' : borderColor,
                      color: textColor,
                    },
                  ]}
                  value={digit}
                  onChangeText={v => handleOtpDigit(i, v)}
                  onKeyPress={({ nativeEvent }) => handleOtpBackspace(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            <TouchableOpacity
              style={[styles.mainBtn, loading && { opacity: 0.6 }]}
              onPress={() => handleVerifyOtp()}
              disabled={loading || otp.length < 4}
            >
              <Text style={styles.mainBtnText}>
                {loading ? (ar ? 'جارٍ التحقق...' : 'Verifying...') : (ar ? 'تحقق' : 'Verify')}
              </Text>
            </TouchableOpacity>

            {/* Resend */}
            <TouchableOpacity onPress={handleResend} disabled={resendTimer > 0} style={{ marginTop: 16 }}>
              <Text style={[styles.resendText, { color: resendTimer > 0 ? subtextColor : '#F4B400' }]}>
                {resendTimer > 0
                  ? (ar ? `إعادة الإرسال بعد ${resendTimer}ث` : `Resend code in ${resendTimer}s`)
                  : (ar ? 'إعادة إرسال الرمز' : 'Resend code')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setStep('phone'); setOtpDigits(['','','','','','']); setOtp('') }} style={{ marginTop: 12 }}>
              <Text style={[styles.backLink, { color: subtextColor }]}>
                {ar ? '← تغيير رقم الهاتف' : ' Change phone number'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP 3: Name ── */}
        {step === 'info' && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: textColor }]}>
              {ar ? 'أخبرنا عن نفسك' : 'Tell us about you'}
            </Text>
            <Text style={[styles.stepSub, { color: subtextColor }]}>
              {ar ? 'سيظهر اسمك للسائقين' : 'Your name will be shown to drivers'}
            </Text>

            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder={ar ? 'الاسم الأول *' : 'First name *'}
              placeholderTextColor={subtextColor}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              textAlign={ar ? 'right' : 'left'}
              autoFocus
            />

            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder={ar ? 'الاسم الأخير (اختياري)' : 'Last name (optional)'}
              placeholderTextColor={subtextColor}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              textAlign={ar ? 'right' : 'left'}
            />

            <TouchableOpacity style={styles.mainBtn} onPress={handleFinish} disabled={loading}>
              <Text style={styles.mainBtnText}>
                {loading ? (ar ? 'جارٍ الإنشاء...' : 'Creating...') : (ar ? 'إنشاء الحساب ✓' : 'Create Account ✓')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sign in link */}
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 8 }}>
          <Text style={[styles.backLink, { color: subtextColor }]}>
            {ar ? 'لديك حساب؟ سجّل دخولك' : 'Already have an account? Sign In'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 60 },
  logo: { fontSize: 56, marginBottom: 6 },
  title: { fontSize: 30, fontWeight: '900', marginBottom: 16 },

  dots: { flexDirection: 'row', gap: 8, marginBottom: 36 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  stepWrap: { alignSelf: 'stretch', alignItems: 'stretch' },
  stepTitle: { fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  stepSub: { fontSize: 14, marginBottom: 28, textAlign: 'center' },

  phoneRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 16, marginBottom: 16, overflow: 'hidden',
  },
  prefixBox: { paddingHorizontal: 14, paddingVertical: 17 },
  prefixText: { fontWeight: '700', fontSize: 15 },
  phoneInput: { flex: 1, padding: 16, fontSize: 16 },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 24 },
  otpBox: {
    width: 46, height: 56, borderWidth: 2, borderRadius: 12,
    fontSize: 22, fontWeight: '800', textAlign: 'center',
  },

  input: {
    borderWidth: 1, borderRadius: 16, padding: 16, fontSize: 16,
    marginBottom: 14, alignSelf: 'stretch',
  },

  mainBtn: {
    backgroundColor: '#F4B400', padding: 18, borderRadius: 16,
    alignItems: 'center', alignSelf: 'stretch', marginBottom: 8,
  },
  mainBtnText: { fontSize: 17, fontWeight: '900', color: '#111827' },

  resendText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },

  backLink: { fontSize: 14, textAlign: 'center', fontWeight: '600', marginTop: 16 },
});
