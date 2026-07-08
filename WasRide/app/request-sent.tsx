import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useAppState } from '@/lib/app-state'

export default function RequestSentScreen() {
  const router = useRouter()
  const { locale, darkMode } = useAppState()
  const ar = locale === 'ar'
  const dark = darkMode

  const bg = dark ? '#0F172A' : '#fff'
  const cardBg = dark ? '#1E293B' : '#F9FAFB'
  const cardBorder = dark ? '#334155' : '#E5E7EB'
  const textPrimary = dark ? '#F1F5F9' : '#111827'
  const textSecondary = dark ? '#94A3B8' : '#6B7280'

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>

      {/* Pulse animation area */}
      <View style={[styles.pulseOuter, { borderColor: dark ? '#F4B400' : '#111827', opacity: 0.15 }]} />
      <View style={[styles.pulseMiddle, { borderColor: dark ? '#F4B400' : '#111827', opacity: 0.3 }]} />
      <View style={[styles.pulseInner, { backgroundColor: dark ? '#F4B400' : '#111827' }]}>
        <Text style={{ fontSize: 32 }}>🏍️</Text>
      </View>

      <ActivityIndicator size="large" color="#F4B400" style={{ marginTop: 40, marginBottom: 16 }} />

      <Text style={[styles.title, { color: textPrimary }]}>
        {ar ? 'تم إرسال الطلب!' : 'Request Sent!'}
      </Text>
      <Text style={[styles.subtitle, { color: textSecondary }]}>
        {ar ? 'جاري البحث عن السائقين القريبين...' : 'Looking for nearby drivers...'}
      </Text>

      {/* Info card */}
      <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Text style={[styles.infoText, { color: textSecondary }]}>
          {ar
            ? 'سيتم إشعارك فور قبول أحد السائقين لطلبك'
            : "You'll be notified as soon as a driver accepts your request"}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: dark ? '#F4B400' : '#111827' }]}
        onPress={() => router.push('/driver-list' as never)}
      >
        <Text style={[styles.buttonText, { color: dark ? '#111827' : '#fff' }]}>
          {ar ? '👀 عرض السائقين المتاحين' : '👀 See Available Drivers'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => router.replace('/' as never)}>
        <Text style={[styles.cancelText, { color: textSecondary }]}>
          {ar ? 'إلغاء' : 'Cancel'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  pulseOuter: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2,
  },
  pulseMiddle: {
    position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 2,
  },
  pulseInner: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  title: {
    fontSize: 28, fontWeight: '900', marginBottom: 8, textAlign: 'center',
  },
  subtitle: {
    fontSize: 16, textAlign: 'center', marginBottom: 24,
  },
  infoCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 32, width: '100%',
  },
  infoText: {
    fontSize: 14, textAlign: 'center', lineHeight: 22,
  },
  button: {
    padding: 18, borderRadius: 16, alignItems: 'center', width: '100%', marginBottom: 12,
  },
  buttonText: { fontSize: 16, fontWeight: '800' },
  cancelBtn: { padding: 16 },
  cancelText: { fontSize: 15, fontWeight: '600' },
})
