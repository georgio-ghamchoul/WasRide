import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useAppState } from '@/lib/app-state'
import { supabase } from '@/lib/supabase'

export default function DriverPendingScreen() {
  const router = useRouter()
  const { locale, darkMode } = useAppState()
  const ar = locale === 'ar'

  useEffect(() => {
    let stopped = false

    async function checkStatus() {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId || stopped) return

      const { data } = await supabase
        .from('profiles')
        .select('approval_status')
        .eq('id', userId)
        .maybeSingle()

      if (stopped) return
      if (data?.approval_status === 'approved') router.replace('/driver/home' as never)
      if (data?.approval_status === 'rejected') router.replace('/login' as never)
    }

    checkStatus()
    const interval = setInterval(checkStatus, 5000)
    return () => { stopped = true; clearInterval(interval) }
  }, [])

  const bg = darkMode ? '#111827' : '#fff'
  const textColor = darkMode ? '#F1F5F9' : '#111827'
  const subtextColor = darkMode ? '#94A3B8' : '#6B7280'
  const cardBg = darkMode ? '#1E293B' : '#F5F5F5'
  const cardText = darkMode ? '#CBD5E1' : '#333'

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>

      {/* Back button */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={[styles.backText, { color: subtextColor }]}>
          {ar ? '→ رجوع' : '← Back'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.emoji}>⏳</Text>

      <Text style={[styles.title, { color: textColor }]}>
        {ar ? 'تم إرسال طلبك!' : 'Application Submitted!'}
      </Text>

      <Text style={[styles.subtitle, { color: subtextColor }]}>
        {ar
          ? 'طلبك قيد المراجعة. سيتم إشعارك فور الموافقة عليه.'
          : "Your application is under review. We'll notify you once approved."}
      </Text>

      <View style={[styles.infoBox, { backgroundColor: cardBg }]}>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>✅</Text>
          <Text style={[styles.infoText, { color: cardText }]}>
            {ar ? 'تم استلام طلبك' : 'Application received'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>⏳</Text>
          <Text style={[styles.infoText, { color: cardText }]}>
            {ar ? 'المراجعة من قبل الإدارة جارية' : 'Admin review in progress'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>📱</Text>
          <Text style={[styles.infoText, { color: cardText }]}>
            {ar ? 'ستتلقى إشعاراً عند الموافقة' : "You'll be notified when approved"}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: darkMode ? '#F4B400' : '#111827' }]}
        onPress={() => router.replace('/login' as never)}
      >
        <Text style={[styles.buttonText, { color: darkMode ? '#111827' : '#fff' }]}>
          {ar ? 'العودة إلى تسجيل الدخول' : 'Back to Login'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backBtn: {
    position: 'absolute', top: 56, left: 24,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  backText: { fontSize: 16, fontWeight: '600' },
  emoji: { fontSize: 64, marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '900', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  infoBox: { borderRadius: 16, padding: 20, width: '100%', marginBottom: 30, gap: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIcon: { fontSize: 18 },
  infoText: { fontSize: 15, flex: 1 },
  button: { padding: 18, borderRadius: 16, alignItems: 'center', width: '100%' },
  buttonText: { fontSize: 17, fontWeight: '900' },
})
