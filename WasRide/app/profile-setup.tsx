import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Image,
} from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import * as ImagePicker from "expo-image-picker";
import { useAppState } from "@/lib/app-state";

export default function ProfileSetupScreen() {
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#FFFFFF';
  const textColor = darkMode ? '#FFFFFF' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const inputBg = darkMode ? '#1F2937' : '#FAFAFA';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';
  const activeBg = darkMode ? '#F4B400' : '#111827';
  const activeText = '#FFFFFF';
  const inactiveText = darkMode ? '#9CA3AF' : '#6B7280';

  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone, vehicle_type, role")
      .eq("id", user.id)
      .maybeSingle();

    if (data) {
      const parts = (data.full_name || "").split(" ");
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      setPhone((data.phone || "").replace("+961", ""));
      if (data.vehicle_type) setVehicleType(data.vehicle_type);
      if (data.role === "driver") setRole("driver");
    }
  }

  async function pickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled) setProfileImage(result.assets[0].uri);
    } catch (e) {
      console.log("Image picker error:", e);
    }
  }

  async function save() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      phone: phone ? `+961${phone}` : undefined,
      vehicle_type: role === "driver" ? vehicleType : undefined,
      role,
    });

    if (error) {
      Alert.alert(ar ? "خطأ" : "Error", error.message);
    } else {
      Alert.alert(ar ? "تم الحفظ" : "Saved", ar ? "تم تحديث ملفك الشخصي" : "Profile updated successfully");
    }
    setLoading(false);
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: bg }]} contentContainerStyle={{ paddingBottom: 40 }}>

      <Text style={[styles.title, { color: textColor }]}>
        {ar ? "إعداد الحساب" : "Profile Setup"}
      </Text>

      {/* ROLE SWITCH */}
      <View style={[styles.switchRow, { borderColor }]}>
        <Pressable
          onPress={() => setRole("passenger")}
          style={[styles.switchBtn, { borderColor }, role === "passenger" && { backgroundColor: activeBg }]}
        >
          <Text style={[styles.switchText, { color: role === "passenger" ? activeText : inactiveText }]}>
            {ar ? "راكب" : "Rider"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setRole("driver")}
          style={[styles.switchBtn, { borderColor }, role === "driver" && { backgroundColor: activeBg }]}
        >
          <Text style={[styles.switchText, { color: role === "driver" ? activeText : inactiveText }]}>
            {ar ? "سائق" : "Driver"}
          </Text>
        </Pressable>
      </View>

      {/* IMAGE */}
      <Pressable onPress={pickImage} style={[styles.imageBox, { borderColor, backgroundColor: inputBg }]}>
        {profileImage ? (
          <Image source={{ uri: profileImage }} style={styles.image} />
        ) : (
          <Text style={{ fontWeight: "700", color: subtextColor, textAlign: "center" }}>
            {role === "driver"
              ? (ar ? "ارفع صورة السائق (مطلوب)" : "Upload Driver Photo (required)")
              : (ar ? "ارفع صورة (اختياري)" : "Upload Photo (optional)")}
          </Text>
        )}
      </Pressable>

      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
        placeholder={ar ? "الاسم الأول" : "First Name"}
        placeholderTextColor={subtextColor}
        value={firstName}
        onChangeText={setFirstName}
      />

      {role === "passenger" && (
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? "الاسم الأخير" : "Last Name"}
          placeholderTextColor={subtextColor}
          value={lastName}
          onChangeText={setLastName}
        />
      )}

      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
        placeholder={ar ? "رقم الهاتف" : "Phone"}
        placeholderTextColor={subtextColor}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />

      {role === "driver" && (
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? "نوع المركبة" : "Vehicle Type"}
          placeholderTextColor={subtextColor}
          value={vehicleType}
          onChangeText={setVehicleType}
        />
      )}

      <Pressable style={[styles.btn, { backgroundColor: activeBg }]} onPress={save}>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
          {loading ? (ar ? "جارٍ الحفظ..." : "Saving...") : (ar ? "حفظ" : "Save Profile")}
        </Text>
      </Pressable>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 24, fontWeight: '900', marginBottom: 24 },
  switchRow: {
    flexDirection: "row",
    marginBottom: 20,
    gap: 10,
  },
  switchBtn: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
  },
  switchText: { fontWeight: "900", fontSize: 15 },
  imageBox: {
    height: 150,
    borderWidth: 1,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  input: {
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  btn: {
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
  },
});
