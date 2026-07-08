import { useState } from "react";
import {
  View, Text, Modal, Pressable, TextInput, StyleSheet, ScrollView,
} from "react-native";

type Role = "rider" | "driver";

const RIDER_REASONS: { key: string; en: string; ar: string }[] = [
  { key: "changed_mind", en: "Changed my mind",     ar: "غيّرت رأيي" },
  { key: "price_high",   en: "Price too high",      ar: "السعر مرتفع" },
  { key: "driver_far",   en: "Driver too far",      ar: "السائق بعيد" },
  { key: "long_wait",    en: "Waiting too long",    ar: "الانتظار طويل" },
  { key: "wrong_pickup", en: "Wrong pickup spot",   ar: "موقع الاستلام خاطئ" },
  { key: "other",        en: "Other",               ar: "أخرى" },
];

const DRIVER_REASONS: { key: string; en: string; ar: string }[] = [
  { key: "rider_no_show", en: "Rider didn't show",  ar: "الراكب لم يحضر" },
  { key: "too_far",       en: "Pickup too far",     ar: "الاستلام بعيد" },
  { key: "price_low",     en: "Price too low",      ar: "السعر منخفض" },
  { key: "rider_request", en: "Rider asked to cancel", ar: "الراكب طلب الإلغاء" },
  { key: "other",         en: "Other",              ar: "أخرى" },
];

export default function CancelReasonModal({
  visible,
  role,
  ar = false,
  darkMode = false,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  role: Role;
  ar?: boolean;
  darkMode?: boolean;
  onClose: () => void;                       // dismiss without cancelling
  onConfirm: (reason: string) => void;       // proceed with cancellation
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [other, setOther] = useState("");

  const reasons = role === "driver" ? DRIVER_REASONS : RIDER_REASONS;

  const bg        = darkMode ? "#1F2937" : "#fff";
  const textColor = darkMode ? "#fff" : "#111827";
  const subColor  = darkMode ? "#9CA3AF" : "#6B7280";
  const chipBg    = darkMode ? "#111827" : "#F3F4F6";
  const border    = darkMode ? "#374151" : "#E5E7EB";

  function reset() { setSelected(null); setOther(""); }

  // "Other" requires typed text; preset reasons are fine on their own.
  const canConfirm = !!selected && (selected !== "other" || other.trim().length > 0);

  function handleConfirm() {
    if (!canConfirm) return;
    const def = reasons.find((r) => r.key === selected);
    const label = selected === "other" ? other.trim() : (def ? def.en : selected!);
    reset();
    onConfirm(label);
  }

  function handleClose() { reset(); onClose(); }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: bg }]}>
          <Text style={[s.title, { color: textColor }]}>
            {ar ? "سبب الإلغاء" : "Why are you cancelling?"}
          </Text>
          <Text style={[s.sub, { color: subColor }]}>
            {ar ? "اختر سببًا للمتابعة" : "Pick a reason to continue"}
          </Text>

          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            {reasons.map((r) => {
              const active = selected === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setSelected(r.key)}
                  style={[
                    s.chip,
                    { backgroundColor: chipBg, borderColor: active ? "#F4B400" : border },
                    active && { borderWidth: 2 },
                  ]}
                >
                  <Text style={[s.chipText, { color: textColor }]}>{ar ? r.ar : r.en}</Text>
                  {active && <Text style={s.check}>✓</Text>}
                </Pressable>
              );
            })}

            {selected === "other" && (
              <TextInput
                style={[s.input, { color: textColor, borderColor: border, backgroundColor: chipBg }]}
                placeholder={ar ? "اكتب السبب..." : "Type your reason..."}
                placeholderTextColor={subColor}
                value={other}
                onChangeText={setOther}
                multiline
                textAlign={ar ? "right" : "left"}
              />
            )}
          </ScrollView>

          <View style={s.row}>
            <Pressable style={[s.btn, { backgroundColor: chipBg }]} onPress={handleClose}>
              <Text style={[s.btnText, { color: textColor }]}>
                {ar ? "تراجع" : "Go back"}
              </Text>
            </Pressable>
            <Pressable
              style={[s.btn, { backgroundColor: canConfirm ? "#EF4444" : border }]}
              onPress={handleConfirm}
              disabled={!canConfirm}
            >
              <Text style={[s.btnText, { color: "#fff" }]}>
                {ar ? "إلغاء الرحلة" : "Cancel ride"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 6 },
  title: { fontSize: 19, fontWeight: "800" },
  sub: { fontSize: 13, marginBottom: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
  },
  chipText: { fontSize: 15, fontWeight: "600" },
  check: { fontSize: 16, color: "#F4B400", fontWeight: "900" },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 70, fontSize: 15, textAlignVertical: "top", marginBottom: 8 },
  row: { flexDirection: "row", gap: 12, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  btnText: { fontSize: 15, fontWeight: "700" },
});
