// Shown to a rider who reached the app without a name yet (e.g. signed in via
// the login screen on a brand-new number). They MUST enter their name here
// before they can order. Existing riders with a name never see this screen.
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, Alert, Image, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

export default function CompleteProfileScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === "ar";

  const bg = darkMode ? "#111827" : "#FFFFFF";
  const textColor = darkMode ? "#FFFFFF" : "#111827";
  const subtextColor = darkMode ? "#9CA3AF" : "#6B7280";
  const inputBg = darkMode ? "#1F2937" : "#FAFAFA";
  const borderColor = darkMode ? "#374151" : "#E5E7EB";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function pickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        return Alert.alert(
          ar ? "إذن مطلوب" : "Permission Required",
          ar ? "يرجى السماح بالوصول إلى مكتبة الصور" : "Please allow access to your photo library"
        );
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled) setProfileImage(result.assets[0].uri);
    } catch (e: any) {
      Alert.alert(ar ? "خطأ" : "Error", e.message);
    }
  }

  async function uploadImage(uri: string, path: string) {
    // FormData upload works reliably in release builds; fetch(uri).blob() does not.
    const formData = new FormData();
    formData.append("file", { uri, name: "photo.jpg", type: "image/jpeg" } as any);
    const { error } = await supabase.storage
      .from("profile-images")
      .upload(path, formData, { upsert: true, contentType: "image/jpeg" });
    if (error) throw error;
  }

  async function handleSave() {
    if (!firstName.trim())
      return Alert.alert(ar ? "خطأ" : "Error", ar ? "أدخل اسمك الأول" : "Please enter your first name");

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Normalize phone to +961XXXXXXXX to match the rest of the app.
      const digits = (user.phone || "").replace(/\D/g, "");
      const local = digits.startsWith("961") ? digits.slice(3) : digits;

      // Save the profile FIRST — this is the critical step.
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        phone: local ? `+961${local}` : undefined,
        role: "rider",
        approval_status: "approved",
      }, { onConflict: "id" });

      if (error) throw error;

      // Optional photo — best-effort, never block onboarding if it fails.
      if (profileImage && !profileImage.startsWith("http")) {
        try { await uploadImage(profileImage, `riders/${user.id}.jpg`); }
        catch (e) { console.log("photo upload failed (non-blocking):", e); }
      }

      router.replace("/" as never);
    } catch (e: any) {
      Alert.alert(ar ? "خطأ" : "Error", e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>🚕</Text>
        <Text style={[styles.title, { color: textColor }]}>
          {ar ? "أكمل ملفك الشخصي" : "Complete your profile"}
        </Text>
        <Text style={[styles.subtitle, { color: subtextColor }]}>
          {ar ? "أدخل اسمك لتتمكن من الطلب" : "Enter your name so you can start ordering"}
        </Text>

        {/* Optional photo */}
        <Pressable onPress={pickImage} style={[styles.imageBox, { borderColor, backgroundColor: inputBg }]}>
          {profileImage ? (
            <Image source={{ uri: profileImage }} style={styles.image} />
          ) : (
            <Text style={{ fontWeight: "700", color: subtextColor, textAlign: "center" }}>
              {ar ? "أضف صورة (اختياري)" : "Add a photo (optional)"}
            </Text>
          )}
        </Pressable>

        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? "الاسم الأول" : "First name"}
          placeholderTextColor={subtextColor}
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? "الاسم الأخير (اختياري)" : "Last name (optional)"}
          placeholderTextColor={subtextColor}
          value={lastName}
          onChangeText={setLastName}
        />

        <Pressable
          style={[styles.btn, { backgroundColor: "#F4B400", opacity: loading ? 0.7 : 1 }]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={styles.btnText}>{ar ? "متابعة" : "Continue"}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  logo: { fontSize: 48, textAlign: "center", marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "900", textAlign: "center" },
  subtitle: { fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 6, marginBottom: 24 },
  imageBox: {
    height: 130, borderWidth: 1, borderRadius: 14, justifyContent: "center",
    alignItems: "center", marginBottom: 16, overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  input: { borderWidth: 1, padding: 14, borderRadius: 12, marginBottom: 12, fontSize: 15 },
  btn: { padding: 16, borderRadius: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#111827", fontWeight: "900", fontSize: 16 },
});
