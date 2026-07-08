import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Image } from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAppState } from "@/lib/app-state";

export default function DriverProfileScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const inputBg = darkMode ? '#1F2937' : '#fafafa';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';
  const cardBg = darkMode ? '#1F2937' : '#F9FAFB';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [driverImage, setDriverImage] = useState<string | null>(null);
  const [vehicleImage, setVehicleImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase.from('profiles').select('full_name, phone, vehicle_type').eq('id', user.id).maybeSingle();
    if (data) {
      const parts = (data.full_name || '').split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.slice(1).join(' ') || '');
      setPhone((data.phone || '').replace('+961', ''));
      setVehicleType(data.vehicle_type || '');
    }

    // Load photos from storage
    setDriverImage(supabase.storage.from('driver-images').getPublicUrl(`drivers/${user.id}.jpg`).data.publicUrl);
    setVehicleImage(supabase.storage.from('driver-images').getPublicUrl(`vehicles/${user.id}.jpg`).data.publicUrl);
  }

  async function pickImage(setter: (uri: string) => void) {
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
  }

  async function uploadImage(uri: string, path: string) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('Failed to fetch image');
    const blob = await res.blob();
    const { error } = await supabase.storage.from('driver-images').upload(path, blob, { upsert: true });
    if (error) throw error;
    return supabase.storage.from('driver-images').getPublicUrl(path).data.publicUrl;
  }

  async function handleSave() {
    if (!firstName) {
      return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'الاسم مطلوب' : 'Name is required');
    }
    if (phone.length !== 8) {
      return Alert.alert(ar ? 'رقم غير صحيح' : 'Invalid Number', ar ? 'رقم الهاتف يجب أن يكون 8 أرقام بالضبط' : 'Phone number must be exactly 8 digits');
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (driverImage && !driverImage.startsWith('http')) {
        await uploadImage(driverImage, `drivers/${user.id}.jpg`);
      }
      if (vehicleImage && !vehicleImage.startsWith('http')) {
        await uploadImage(vehicleImage, `vehicles/${user.id}.jpg`);
      }

      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name: `${firstName} ${lastName}`.trim(),
        phone: `+961${phone}`,
        vehicle_type: vehicleType,
        role: 'driver',
      }, { onConflict: 'id' });

      if (error) throw error;
      Alert.alert(ar ? 'تم الحفظ' : 'Saved', ar ? 'تم تحديث الملف الشخصي' : 'Profile updated successfully');
    } catch (e: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.back, { color: textColor }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor }]}>{ar ? 'ملف السائق' : 'Driver Profile'}</Text>
        <View style={{ width: 30 }} />
      </View>

      {/* DRIVER PHOTO */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          {ar ? '📸 صورة السائق' : '📸 Driver Photo'}
        </Text>
        <TouchableOpacity onPress={() => pickImage(setDriverImage)} style={[styles.photoBox, { borderColor }]}>
          {driverImage ? (
            <Image
              source={{ uri: driverImage }}
              style={styles.photo}
              onError={() => setDriverImage(null)}
            />
          ) : (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 36 }}>👤</Text>
              <Text style={{ color: subtextColor, fontWeight: '700', fontSize: 13 }}>
                {ar ? 'ارفع صورة السائق' : 'Upload Driver Photo'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={[styles.photoHint, { color: subtextColor }]}>
          {ar ? 'اضغط لتغيير الصورة' : 'Tap to change photo'}
        </Text>
      </View>

      {/* VEHICLE PHOTO */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          {vehicleType === 'Tuktuk' ? '🛺' : vehicleType === 'Car' ? '🚗' : '🏍'} {ar ? 'صورة المركبة' : 'Vehicle Photo'}
        </Text>
        <TouchableOpacity onPress={() => pickImage(setVehicleImage)} style={[styles.photoBox, { borderColor }]}>
          {vehicleImage ? (
            <Image
              source={{ uri: vehicleImage }}
              style={styles.photo}
              onError={() => setVehicleImage(null)}
            />
          ) : (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 36 }}>{vehicleType === 'Tuktuk' ? '🛺' : vehicleType === 'Car' ? '🚗' : '🏍'}</Text>
              <Text style={{ color: subtextColor, fontWeight: '700', fontSize: 13 }}>
                {ar ? 'ارفع صورة المركبة' : 'Upload Vehicle Photo'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={[styles.photoHint, { color: subtextColor }]}>
          {ar ? 'اضغط لتغيير الصورة' : 'Tap to change photo'}
        </Text>
      </View>

      {/* FORM */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>

        <Text style={[styles.label, { color: subtextColor }]}>{ar ? 'الاسم الأول' : 'First Name'}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? 'الاسم الأول' : 'First Name'}
          placeholderTextColor={subtextColor}
          value={firstName}
          onChangeText={setFirstName}
          textAlign={ar ? 'right' : 'left'}
        />

        <Text style={[styles.label, { color: subtextColor }]}>{ar ? 'الاسم الأخير' : 'Last Name'}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? 'الاسم الأخير' : 'Last Name'}
          placeholderTextColor={subtextColor}
          value={lastName}
          onChangeText={setLastName}
          textAlign={ar ? 'right' : 'left'}
        />

        <Text style={[styles.label, { color: subtextColor }]}>{ar ? 'رقم الهاتف' : 'Phone Number'}</Text>
        <View style={[styles.phoneRow, { borderColor, backgroundColor: inputBg }]}>
          <View style={[styles.prefix, { backgroundColor: darkMode ? '#374151' : '#E5E7EB' }]}>
            <Text style={[styles.prefixText, { color: textColor }]}>🇱🇧 +961</Text>
          </View>
          <TextInput
            style={[styles.phoneInput, { color: textColor }]}
            placeholder="12 345 678"
            placeholderTextColor={subtextColor}
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ''))}
            keyboardType="phone-pad"
            maxLength={8}
          />
        </View>

        <Text style={[styles.label, { color: subtextColor }]}>{ar ? 'نوع المركبة' : 'Vehicle Type'}</Text>
        <View style={styles.vehicleRow}>
          {[
            { key: 'Motorcycle', ar: 'دراجة نارية', icon: '🏍' },
            { key: 'Tuktuk', ar: 'تكتك', icon: '🛺' },
            { key: 'Car', ar: 'سيارة', icon: '🚗' },
          ].map((type) => (
            <TouchableOpacity key={type.key} onPress={() => setVehicleType(type.key)} style={{ flex: 1 }}>
              <View style={[styles.vehicleOption, vehicleType === type.key && styles.vehicleSelected]}>
                <Text style={{ fontSize: 20 }}>{type.icon}</Text>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                  {ar ? type.ar : type.key}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* SAVE */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveBtnText}>
          {saving ? (ar ? 'جارٍ الحفظ...' : 'Saving...') : (ar ? '💾 حفظ التغييرات' : '💾 Save Changes')}
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, marginTop: 40 },
  back: { fontSize: 36, fontWeight: '300', lineHeight: 40 },
  title: { fontSize: 20, fontWeight: '900' },
  card: { borderRadius: 18, padding: 18, borderWidth: 1, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  photoBox: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, height: 150, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  photoHint: { fontSize: 11, textAlign: 'center', marginTop: 6 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 14 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, marginBottom: 14, overflow: 'hidden' },
  prefix: { paddingHorizontal: 12, paddingVertical: 14 },
  prefixText: { fontWeight: '700', fontSize: 14 },
  phoneInput: { flex: 1, padding: 14, fontSize: 15 },
  vehicleRow: { flexDirection: 'row', gap: 10 },
  vehicleOption: { backgroundColor: '#374151', borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 },
  vehicleSelected: { backgroundColor: '#16A34A' },
  saveBtn: { backgroundColor: '#F4B400', borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 8, shadowColor: '#F4B400', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 7 },
  saveBtnText: { color: '#111827', fontSize: 16, fontWeight: '900' },
});
