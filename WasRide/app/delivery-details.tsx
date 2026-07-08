import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialIcons, Feather, Ionicons } from "@expo/vector-icons";
import { useAppState } from "@/lib/app-state";

// ── Defined outside the screen so they are stable across re-renders ──────────

function FieldLabel({ icon, text, subtext }: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  text: string;
  subtext: string;
}) {
  return (
    <View style={styles.labelRow}>
      <MaterialIcons name={icon} size={14} color={subtext} style={{ marginRight: 6 }} />
      <Text style={[styles.label, { color: subtext }]}>{text}</Text>
    </View>
  );
}

function PhoneField({ value, onChange, inputBg, borderColor, textColor, subtext }: {
  value: string;
  onChange: (v: string) => void;
  inputBg: string;
  borderColor: string;
  textColor: string;
  subtext: string;
}) {
  return (
    <View style={[styles.phoneRow, { borderColor, backgroundColor: inputBg }]}>
      <View style={[styles.prefix, { backgroundColor: borderColor }]}>
        <Text style={[styles.prefixText, { color: textColor }]}>🇱🇧 +961</Text>
      </View>
      <TextInput
        style={[styles.phoneInput, { color: textColor }]}
        placeholder="12 345 678"
        placeholderTextColor={subtext}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ""))}
        keyboardType="phone-pad"
        maxLength={8}
      />
    </View>
  );
}

export default function DeliveryDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === "ar";

  const bg          = darkMode ? "#0F172A" : "#FFFFFF";
  const textColor   = darkMode ? "#F1F5F9" : "#111827";
  const subtext     = darkMode ? "#94A3B8" : "#6B7280";
  const inputBg     = darkMode ? "#1E293B" : "#F8FAFC";
  const borderColor = darkMode ? "#334155" : "#E2E8F0";
  const labelColor  = darkMode ? "#CBD5E1" : "#374151";
  const cardBg      = darkMode ? "#1E293B" : "#F8FAFC";

  const [selectedType, setSelectedType] = useState<"store" | "courier">("store");

  const [storeName, setStoreName] = useState("");
  const [yourPhone, setYourPhone] = useState("");
  const [storeNote, setStoreNote] = useState("");

  const [senderPhone, setSenderPhone]       = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [deliveryType, setDeliveryType]     = useState("");
  const [courierNote, setCourierNote]       = useState("");

  const itemTypes = [
    { key: "Documents", labelEn: "Documents", labelAr: "وثائق",  icon: "description" as const },
    { key: "Keys",      labelEn: "Keys",      labelAr: "مفاتيح", icon: "vpn-key"     as const },
    { key: "Bag",       labelEn: "Bag",       labelAr: "حقيبة",  icon: "shopping-bag" as const },
    { key: "Food",      labelEn: "Food",      labelAr: "طعام",   icon: "restaurant"  as const },
    { key: "Other",     labelEn: "Other",     labelAr: "أخرى",   icon: "inventory-2" as const },
  ];

  function handleContinue() {
    if (selectedType === "store") {
      if (!storeName) {
        Alert.alert(ar ? "معلومات ناقصة" : "Missing Info", ar ? "يرجى ملء اسم المتجر" : "Please enter the store name");
        return;
      }
      if (yourPhone.length !== 8) {
        Alert.alert(ar ? "رقم غير صحيح" : "Invalid Number", ar ? "رقم الهاتف يجب أن يكون 8 أرقام بالضبط" : "Phone number must be exactly 8 digits");
        return;
      }
    } else {
      if (senderPhone.length !== 8) {
        Alert.alert(ar ? "رقم غير صحيح" : "Invalid Number", ar ? "رقم هاتف المرسل يجب أن يكون 8 أرقام" : "Sender phone must be exactly 8 digits");
        return;
      }
      if (recipientPhone.length !== 8) {
        Alert.alert(ar ? "رقم غير صحيح" : "Invalid Number", ar ? "رقم هاتف المستلم يجب أن يكون 8 أرقام" : "Recipient phone must be exactly 8 digits");
        return;
      }
      if (!deliveryType) {
        Alert.alert(ar ? "معلومات ناقصة" : "Missing Info", ar ? "يرجى اختيار نوع الشحنة" : "Please select what to deliver");
        return;
      }
    }
    router.push({
      pathname: "confirm-ride" as never,
      params: {
        pickupLat: params.pickupLat, pickupLng: params.pickupLng,
        destLat: params.destLat,     destLng: params.destLng,
        service: "couriers",         deliveryType: selectedType,
        storeName, yourPhone, storeNote,
        senderPhone, recipientPhone, itemType: deliveryType, courierNote,
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* HEADER */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: textColor }]}>
            {ar ? "تفاصيل التوصيل" : "Delivery Details"}
          </Text>
          <Text style={[styles.subtitle, { color: subtext }]}>
            {ar ? "أخبرنا المزيد عن طلبك" : "Tell us more about your order"}
          </Text>
        </View>

        {/* TYPE SELECTOR */}
        <View style={styles.typeRow}>
          {/* From Store */}
          <Pressable onPress={() => setSelectedType("store")} style={{ flex: 1 }}>
            <View style={[
              styles.typeBtn,
              { backgroundColor: cardBg, borderColor },
              selectedType === "store" && { borderColor: "#F4B400", backgroundColor: darkMode ? "#2D2A1A" : "#FFFBEB" },
            ]}>
              <View style={[
                styles.typeIconWrap,
                { backgroundColor: selectedType === "store" ? "#F4B400" : (darkMode ? "#334155" : "#E2E8F0") },
              ]}>
                <MaterialIcons name="storefront" size={22} color={selectedType === "store" ? "#111827" : subtext} />
              </View>
              <Text style={[styles.typeBtnText, { color: selectedType === "store" ? textColor : subtext }]}>
                {ar ? "من متجر" : "From Store"}
              </Text>
            </View>
          </Pressable>

          {/* Send Package */}
          <Pressable onPress={() => setSelectedType("courier")} style={{ flex: 1 }}>
            <View style={[
              styles.typeBtn,
              { backgroundColor: cardBg, borderColor },
              selectedType === "courier" && { borderColor: "#F4B400", backgroundColor: darkMode ? "#2D2A1A" : "#FFFBEB" },
            ]}>
              <View style={[
                styles.typeIconWrap,
                { backgroundColor: selectedType === "courier" ? "#F4B400" : (darkMode ? "#334155" : "#E2E8F0") },
              ]}>
                <Ionicons name="cube-outline" size={22} color={selectedType === "courier" ? "#111827" : subtext} />
              </View>
              <Text style={[styles.typeBtnText, { color: selectedType === "courier" ? textColor : subtext }]}>
                {ar ? "إرسال طرد" : "Send Package"}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* ── FROM STORE FORM ── */}
        {selectedType === "store" && (
          <View style={styles.form}>
            <FieldLabel subtext={subtext} icon="storefront" text={ar ? "اسم المتجر *" : "Store Name *"} />
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder={ar ? "مثال: سبينيس، صيدلية ABC..." : "e.g. Spinneys, ABC Pharmacy..."}
              placeholderTextColor={subtext}
              value={storeName}
              onChangeText={setStoreName}
              textAlign={ar ? "right" : "left"}
            />

            <View style={styles.fieldGap} />
            <FieldLabel subtext={subtext} icon="phone" text={ar ? "رقم هاتفك *" : "Your Phone Number *"} />
            <PhoneField value={yourPhone} onChange={setYourPhone} inputBg={inputBg} borderColor={borderColor} textColor={textColor} subtext={subtext} />

            <View style={styles.fieldGap} />
            <FieldLabel subtext={subtext} icon="receipt-long" text={ar ? "ماذا تحتاج؟ *" : "What do you need? *"} />
            <TextInput
              style={[styles.input, styles.multiline, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder={ar ? "مثال: ساندويشتان + بيبسي، بنادول 500mg..." : "e.g. 2 sandwiches + Pepsi, panadol 500mg x2..."}
              placeholderTextColor={subtext}
              value={storeNote}
              onChangeText={setStoreNote}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              textAlign={ar ? "right" : "left"}
            />
          </View>
        )}

        {/* ── COURIER FORM ── */}
        {selectedType === "courier" && (
          <View style={styles.form}>
            <FieldLabel subtext={subtext} icon="phone" text={ar ? "رقم هاتف المرسل *" : "Sender Phone *"} />
            <PhoneField value={senderPhone} onChange={setSenderPhone} inputBg={inputBg} borderColor={borderColor} textColor={textColor} subtext={subtext} />

            <View style={styles.fieldGap} />
            <FieldLabel subtext={subtext} icon="phone-forwarded" text={ar ? "رقم هاتف المستلم *" : "Recipient Phone *"} />
            <PhoneField value={recipientPhone} onChange={setRecipientPhone} inputBg={inputBg} borderColor={borderColor} textColor={textColor} subtext={subtext} />

            <View style={styles.fieldGap} />
            <FieldLabel subtext={subtext} icon="inventory-2" text={ar ? "ماذا تريد إرساله؟ *" : "What to Deliver *"} />
            <View style={styles.itemTypeRow}>
              {itemTypes.map((type) => {
                const active = deliveryType === type.key;
                return (
                  <Pressable key={type.key} onPress={() => setDeliveryType(type.key)}>
                    <View style={[
                      styles.itemTypeBtn,
                      { backgroundColor: active ? "#F4B400" : cardBg, borderColor: active ? "#F4B400" : borderColor },
                    ]}>
                      <MaterialIcons name={type.icon} size={15} color={active ? "#111827" : subtext} />
                      <Text style={[styles.itemTypeBtnText, { color: active ? "#111827" : subtext }]}>
                        {ar ? type.labelAr : type.labelEn}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.fieldGap} />
            <FieldLabel subtext={subtext} icon="chat-bubble-outline" text={ar ? "ملاحظة إضافية" : "Additional Note"} />
            <TextInput
              style={[styles.input, { height: 90, backgroundColor: inputBg, borderColor, color: textColor, textAlignVertical: "top" }]}
              placeholder={ar ? "مثال: تعامل بحذر، مواد هشة..." : "e.g. Handle with care, fragile items..."}
              placeholderTextColor={subtext}
              value={courierNote}
              onChangeText={setCourierNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              textAlign={ar ? "right" : "left"}
            />
          </View>
        )}

        {/* CONTINUE */}
        <Pressable
          onPress={handleContinue}
          style={({ pressed }) => [styles.continueBtn, pressed && { opacity: 0.87 }]}
        >
          <Text style={styles.continueBtnText}>
            {ar ? "متابعة — تحديد السعر" : "Continue — Set Price"}
          </Text>
          <Feather name="arrow-right" size={18} color="#111827" style={{ marginLeft: 8 }} />
        </Pressable>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 24, paddingTop: 64, paddingBottom: 48 },

  header:   { marginBottom: 24 },
  title:    { fontSize: 28, fontWeight: '900', marginBottom: 6, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 20 },

  typeRow:     { flexDirection: 'row', gap: 12, marginBottom: 24 },
  typeBtn:     { borderRadius: 18, borderWidth: 1.5, padding: 20, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  typeIconWrap:{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  typeBtnText: { fontSize: 13, fontWeight: '700' },

  form:     { marginBottom: 24 },
  fieldGap: { height: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  label:    { fontSize: 13, fontWeight: '700' },

  input:     { borderWidth: 1.5, borderRadius: 14, padding: 16, fontSize: 15 },
  multiline: { height: 110, textAlignVertical: 'top' },

  phoneRow:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 14, overflow: 'hidden' },
  prefix:     { paddingHorizontal: 14, paddingVertical: 16 },
  prefixText: { fontWeight: '700', fontSize: 14 },
  phoneInput: { flex: 1, padding: 16, fontSize: 15 },

  itemTypeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemTypeBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5 },
  itemTypeBtnText:{ fontSize: 13, fontWeight: '600' },

  continueBtn: {
    flexDirection: 'row', backgroundColor: '#F4B400', borderRadius: 18,
    paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    marginTop: 24,
    shadowColor: '#F4B400', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38, shadowRadius: 10, elevation: 7,
  },
  continueBtnText: { color: '#111827', fontSize: 16, fontWeight: '900' },
});
