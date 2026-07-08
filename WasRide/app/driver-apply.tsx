import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, Image,
} from "react-native";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { sendWhatsappOtp, verifyWhatsappOtp } from "@/lib/whatsapp-otp";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAppState } from "@/lib/app-state";

export default function DriverApplyScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';
  const bg = darkMode ? '#111827' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const inputBg = darkMode ? '#1F2937' : '#fafafa';
  const borderColor = darkMode ? '#374151' : '#ddd';
  const cardBg = darkMode ? '#1F2937' : '#F9FAFB';

  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  const [vehicleType, setVehicleType] = useState('');
  const [idPhotoFront, setIdPhotoFront] = useState<string | null>(null);
  const [idPhotoBack, setIdPhotoBack] = useState<string | null>(null);
  const [selfieWithId, setSelfieWithId] = useState<string | null>(null);
  const [licenseFront, setLicenseFront] = useState<string | null>(null);
  const [licenseBack, setLicenseBack] = useState<string | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [vehicleImage, setVehicleImage] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function pickImage(setter: (uri: string) => void) {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return Alert.alert(
          ar ? 'إذن مطلوب' : 'Permission Required',
          ar ? 'يرجى السماح بالوصول إلى مكتبة الصور' : 'Please allow access to your photo library'
        );
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled) setter(result.assets[0].uri);
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message);
    }
  }

  async function uploadImage(uri: string, path: string) {
    const formData = new FormData();
    formData.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    const { error } = await supabase.storage
      .from('driver-images')
      .upload(path, formData, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    return supabase.storage.from('driver-images').getPublicUrl(path).data.publicUrl;
  }

  // ─── Step 1: validate & send OTP ────────────────────────────────────────────

  async function handleSendOtp() {
    if (!fullName.trim() || !vehicleType)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'يرجى ملء جميع الحقول' : 'Please fill all fields');
    if (phone.length !== 8)
      return Alert.alert(ar ? 'رقم غير صحيح' : 'Invalid Number', ar ? 'رقم الهاتف يجب أن يكون 8 أرقام بالضبط' : 'Phone number must be exactly 8 digits');
    if (!idPhotoFront)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة الهوية (أمامية) مطلوبة' : 'ID photo (front) is required');
    if (!idPhotoBack)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة الهوية (خلفية) مطلوبة' : 'ID photo (back) is required');
    if (!selfieWithId)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة سيلفي مع الهوية مطلوبة' : 'Selfie with ID is required');
    if (!licenseNumber.trim())
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'رقم رخصة القيادة مطلوب' : "Driver's license number is required");
    if (!licenseFront)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة رخصة القيادة (أمامية) مطلوبة' : "Driver's license photo (front) is required");
    if (!licenseBack)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة رخصة القيادة (خلفية) مطلوبة' : "Driver's license photo (back) is required");
    if (!vehicleImage)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'صورة المركبة مطلوبة' : 'Vehicle photo is required');
    if (!profilePhoto)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'الصورة الشخصية مطلوبة' : 'Profile photo is required');

    setLoading(true);
    try {
      await sendWhatsappOtp(`+961${phone}`);
      setOtpDigits(['', '', '', '']);
      setOtp('');
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 300);
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message || 'Could not send the code.');
    } finally {
      setLoading(false);
    }
  }

  // ─── OTP input handling ─────────────────────────────────────────────────────

  function handleOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    const combined = next.join('');
    setOtp(combined);
    if (digit && index < 3) otpRefs.current[index + 1]?.focus();
    if (combined.length === 4) handleVerifyAndSubmit(combined);
  }

  function handleOtpBackspace(index: number, key: string) {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      const next = [...otpDigits];
      next[index - 1] = '';
      setOtpDigits(next);
      setOtp(next.join(''));
      otpRefs.current[index - 1]?.focus();
    }
  }

  // ─── Step 2: verify OTP → upload images → save profile ──────────────────────

  async function handleVerifyAndSubmit(code?: string) {
    const token = code ?? otp;
    if (token.length < 4)
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'أدخل رمز التحقق المكون من 4 أرقام' : 'Enter the 4-digit code');

    try {
      setLoading(true);

      // Verify the WhatsApp code; this also establishes the Supabase session.
      await verifyWhatsappOtp(`+961${phone}`, token);

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) throw new Error(ar ? 'فشل التحقق من الهوية' : 'Authentication failed');

      // Save profile row
      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: userId,
        full_name: fullName,
        phone: `+961${phone}`,
        vehicle_type: vehicleType,
        license_number: licenseNumber.trim(),
        role: 'driver',
        approval_status: 'pending',
      }, { onConflict: 'id' });
      if (upsertError) throw upsertError;

      // Upload all photos in the background
      const uploads: Promise<any>[] = [];
      if (profilePhoto)   uploads.push(uploadImage(profilePhoto,   `drivers/${userId}.jpg`));
      if (vehicleImage)   uploads.push(uploadImage(vehicleImage,   `vehicles/${userId}.jpg`));
      if (idPhotoFront)   uploads.push(uploadImage(idPhotoFront,   `drivers/id-front-${userId}.jpg`));
      if (idPhotoBack)    uploads.push(uploadImage(idPhotoBack,    `drivers/id-back-${userId}.jpg`));
      if (selfieWithId)   uploads.push(uploadImage(selfieWithId,   `drivers/selfie-${userId}.jpg`));
      if (licenseFront)   uploads.push(uploadImage(licenseFront,   `drivers/license-front-${userId}.jpg`));
      if (licenseBack)    uploads.push(uploadImage(licenseBack,    `drivers/license-back-${userId}.jpg`));
      await Promise.allSettled(uploads); // don't block navigation on upload errors

      router.replace('/driver-pending');
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Photo upload card ───────────────────────────────────────────────────────

  function PhotoCard({
    uri, onPress, label, hint, required = false,
  }: {
    uri: string | null;
    onPress: () => void;
    label: string;
    hint: string;
    required?: boolean;
  }) {
    return (
      <>
        <Text style={[styles.label, { color: textColor }]}>
          {label}
          {required && <Text style={{ color: '#EF4444' }}> *</Text>}
        </Text>
        <TouchableOpacity
          style={[styles.photoCard, { borderColor: uri ? '#16A34A' : borderColor, backgroundColor: cardBg }]}
          onPress={onPress}
          activeOpacity={0.75}
        >
          {uri ? (
            <Image source={{ uri }} style={styles.photoPreview} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>📷</Text>
              <Text style={[styles.photoHint, { color: subtextColor }]}>{hint}</Text>
            </View>
          )}
          {uri && (
            <View style={styles.changeOverlay}>
              <Text style={styles.changeText}>{ar ? 'تغيير' : 'Change'}</Text>
            </View>
          )}
        </TouchableOpacity>
      </>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={{ backgroundColor: bg }}
      contentContainerStyle={[styles.container, { backgroundColor: bg }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: textColor }]}>
        🚗 {ar ? 'انضم كسائق' : 'Become a Driver'}
      </Text>
      <Text style={[styles.subtitle, { color: subtextColor }]}>
        {ar
          ? 'يرجى تعبئة جميع الحقول — سيتم مراجعة طلبك خلال 24 ساعة'
          : 'Fill all fields — your application will be reviewed within 24 hours'}
      </Text>

      {step === 'form' ? (
        <>
          {/* ── Full Name ── */}
          <Text style={[styles.label, { color: textColor }]}>
            {ar ? 'الاسم الكامل' : 'Full Name'}<Text style={{ color: '#EF4444' }}> *</Text>
          </Text>
          <TextInput
            placeholder={ar ? 'أدخل اسمك الكامل' : 'Enter your full name'}
            placeholderTextColor={subtextColor}
            value={fullName}
            onChangeText={setFullName}
            maxLength={20}
            style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
            textAlign={ar ? 'right' : 'left'}
          />

          {/* ── Phone ── */}
          <Text style={[styles.label, { color: textColor }]}>
            {ar ? 'رقم الهاتف' : 'Phone'}<Text style={{ color: '#EF4444' }}> *</Text>
          </Text>
          <View style={[styles.phoneRow, { borderColor, backgroundColor: inputBg }]}>
            <View style={[styles.prefixBox, { backgroundColor: darkMode ? '#374151' : '#E5E7EB' }]}>
              <Text style={[styles.prefixText, { color: textColor }]}>+961</Text>
            </View>
            <TextInput
              placeholder="12 345 678"
              placeholderTextColor={subtextColor}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ''))}
              keyboardType="phone-pad"
              maxLength={8}
              style={[styles.phoneInput, { color: textColor }]}
            />
          </View>

          {/* ── Section: Identity Documents ── */}
          <View style={[styles.sectionHeader, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              🪪 {ar ? 'وثائق الهوية' : 'Identity Documents'}
            </Text>
          </View>

          {/* ID Photo Front */}
          <PhotoCard
            uri={idPhotoFront}
            onPress={() => pickImage(setIdPhotoFront)}
            label={ar ? 'صورة الهوية — الوجه الأمامي' : 'ID Photo — Front Side'}
            hint={ar ? 'ارفع الوجه الأمامي للهوية' : 'Upload front side of your ID'}
            required
          />

          {/* ID Photo Back */}
          <PhotoCard
            uri={idPhotoBack}
            onPress={() => pickImage(setIdPhotoBack)}
            label={ar ? 'صورة الهوية — الوجه الخلفي' : 'ID Photo — Back Side'}
            hint={ar ? 'ارفع الوجه الخلفي للهوية' : 'Upload back side of your ID'}
            required
          />

          {/* Selfie with ID */}
          <PhotoCard
            uri={selfieWithId}
            onPress={() => pickImage(setSelfieWithId)}
            label={ar ? 'صورة سيلفي مع الهوية' : 'Selfie with ID'}
            hint={ar ? 'التقط صورة وأنت تمسك هويتك' : 'Take a photo holding your ID next to your face'}
            required
          />

          {/* ── Section: Driver's License ── */}
          <View style={[styles.sectionHeader, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              🚗 {ar ? 'رخصة القيادة' : "Driver's License"}
            </Text>
          </View>

          {/* License number */}
          <Text style={[styles.label, { color: textColor }]}>
            {ar ? 'رقم رخصة القيادة' : "Driver's License Number"}<Text style={{ color: '#EF4444' }}> *</Text>
          </Text>
          <TextInput
            placeholder={ar ? 'رقم الرخصة' : 'License number'}
            placeholderTextColor={subtextColor}
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            autoCapitalize="characters"
            style={{
              borderWidth: 1,
              borderColor: darkMode ? '#4B5563' : '#D1D5DB',
              backgroundColor: darkMode ? '#374151' : '#fff',
              borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12, color: textColor,
            }}
          />

          {/* License Front */}
          <PhotoCard
            uri={licenseFront}
            onPress={() => pickImage(setLicenseFront)}
            label={ar ? 'رخصة القيادة — الوجه الأمامي' : "Driver's License — Front"}
            hint={ar ? 'ارفع الوجه الأمامي للرخصة' : 'Upload the front of your license'}
            required
          />

          {/* License Back */}
          <PhotoCard
            uri={licenseBack}
            onPress={() => pickImage(setLicenseBack)}
            label={ar ? 'رخصة القيادة — الوجه الخلفي' : "Driver's License — Back"}
            hint={ar ? 'ارفع الوجه الخلفي للرخصة' : 'Upload the back of your license'}
            required
          />

          {/* ── Section: Vehicle ── */}
          <View style={[styles.sectionHeader, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              🏍️ {ar ? 'معلومات المركبة' : 'Vehicle Info'}
            </Text>
          </View>

          {/* Vehicle type */}
          <Text style={[styles.label, { color: textColor }]}>
            {ar ? 'نوع المركبة' : 'Vehicle Type'}<Text style={{ color: '#EF4444' }}> *</Text>
          </Text>
          <View style={styles.row}>
            {[
              { key: 'Motorcycle', ar: 'دراجة نارية', icon: '🏍' },
              { key: 'Tuktuk', ar: 'تكتك', icon: '🛺' },
              { key: 'Car', ar: 'سيارة', icon: '🚗' },
            ].map((type) => (
              <TouchableOpacity key={type.key} onPress={() => setVehicleType(type.key)}>
                <View style={[
                  styles.option,
                  { backgroundColor: darkMode ? '#374151' : '#E5E7EB' },
                  vehicleType === type.key && styles.selected,
                ]}>
                  <Text style={{ color: vehicleType === type.key ? '#fff' : textColor, fontWeight: '700' }}>
                    {type.icon} {ar ? type.ar : type.key}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Vehicle Photo */}
          <PhotoCard
            uri={vehicleImage}
            onPress={() => pickImage(setVehicleImage)}
            label={ar ? 'صورة المركبة' : 'Vehicle Photo'}
            hint={ar ? 'ارفع صورة واضحة للمركبة' : 'Upload a clear photo of your vehicle'}
            required
          />

          {/* ── Section: Profile Photo ── */}
          <View style={[styles.sectionHeader, { backgroundColor: darkMode ? '#1F2937' : '#F3F4F6' }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              🤳 {ar ? 'الصورة الشخصية' : 'Profile Photo'}
            </Text>
          </View>

          <PhotoCard
            uri={profilePhoto}
            onPress={() => pickImage(setProfilePhoto)}
            label={ar ? 'صورتك الشخصية' : 'Your Profile Photo'}
            hint={ar ? 'صورة واضحة لوجهك — ستظهر للركاب' : 'Clear face photo — riders will see this'}
            required
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleSendOtp}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading
                ? (ar ? 'جارٍ الإرسال...' : 'Sending...')
                : (ar ? 'إرسال رمز التحقق' : 'Send Verification Code')}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* ── OTP step ── */}
          <Text style={[styles.otpHint, { color: subtextColor }]}>
            {ar
              ? `تم إرسال رمز التحقق إلى +961${phone}`
              : `We sent a 4-digit code to +961${phone}`}
          </Text>

          <View style={styles.otpRow}>
            {otpDigits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(ref) => { otpRefs.current[i] = ref; }}
                style={[styles.otpBox, {
                  backgroundColor: inputBg,
                  borderColor: digit ? '#16A34A' : borderColor,
                  color: textColor,
                }]}
                value={digit}
                onChangeText={(v) => handleOtpDigit(i, v)}
                onKeyPress={({ nativeEvent }) => handleOtpBackspace(i, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={1}
                textAlign="center"
                selectTextOnFocus
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={() => handleVerifyAndSubmit()}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading
                ? (ar ? 'جارٍ التحقق...' : 'Verifying...')
                : (ar ? 'تأكيد وإرسال الطلب' : 'Verify & Submit')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setStep('form'); setOtp(''); }}
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Text style={[styles.backLink, { color: subtextColor }]}>
              {ar ? '← تغيير رقم الهاتف' : '← Change phone number'}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 60, paddingBottom: 60 },

  title: { fontSize: 26, fontWeight: '900', marginBottom: 6 },
  subtitle: { fontSize: 13, marginBottom: 24, lineHeight: 18 },

  label: { fontWeight: '700', marginBottom: 8, marginTop: 12, fontSize: 14 },

  input: {
    borderWidth: 1, padding: 14, borderRadius: 12,
    marginBottom: 4, fontSize: 15,
  },
  phoneRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 12, marginBottom: 4, overflow: 'hidden',
  },
  prefixBox: { paddingHorizontal: 14, paddingVertical: 16 },
  prefixText: { fontWeight: '700', fontSize: 15 },
  phoneInput: { flex: 1, padding: 14, fontSize: 15 },

  sectionHeader: {
    marginTop: 24, marginBottom: 4, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  sectionTitle: { fontWeight: '800', fontSize: 15 },

  row: { flexDirection: 'row', gap: 10, marginVertical: 10 },
  option: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12,
  },
  selected: { backgroundColor: '#16A34A' },

  // Photo card
  photoCard: {
    borderWidth: 1.5, borderRadius: 14, marginBottom: 4,
    overflow: 'hidden', minHeight: 110,
  },
  photoPreview: { width: '100%', height: 160, resizeMode: 'cover' },
  photoPlaceholder: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 24, gap: 8,
  },
  photoIcon: { fontSize: 30 },
  photoHint: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 16 },
  changeOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 6, alignItems: 'center',
  },
  changeText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Buttons
  btn: {
    backgroundColor: '#16A34A', padding: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 24, marginBottom: 12,
  },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 16 },

  // OTP
  otpHint: { fontSize: 15, textAlign: 'center', marginBottom: 28, marginTop: 8, lineHeight: 22 },

  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 24 },
  otpBox: { width: 52, height: 60, borderRadius: 14, borderWidth: 1.5, fontSize: 26, fontWeight: '900', textAlign: 'center' },
  backLink: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 16 },
});
