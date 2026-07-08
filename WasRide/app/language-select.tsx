import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAppState } from '@/lib/app-state'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function LanguageSelectScreen() {
  const router = useRouter()
  const { setLocale } = useAppState()

  async function selectLanguage(lang: 'en' | 'ar') {
    setLocale(lang)
    await AsyncStorage.setItem('language', lang)
    router.replace('/login' as never)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚕</Text>
      <Text style={styles.titleEn}>Welcome to Wasl</Text>
      <Text style={styles.titleAr}>مرحباً بك في وصل</Text>
      <Text style={styles.subtitle}>Choose your language / اختر لغتك</Text>

      <Pressable style={styles.langBtn} onPress={() => selectLanguage('en')}>
        <Text style={styles.langFlag}>🇬🇧</Text>
        <Text style={styles.langText}>English</Text>
      </Pressable>

      <Pressable style={[styles.langBtn, styles.langBtnAr]} onPress={() => selectLanguage('ar')}>
        <Text style={styles.langFlag}>🇱🇧</Text>
        <Text style={styles.langText}>العربية</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emoji: {
    fontSize: 70,
    marginBottom: 16,
  },
  titleEn: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  titleAr: {
    fontSize: 24,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 48,
    textAlign: 'center',
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#1F2937',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#374151',
  },
  langBtnAr: {
    borderColor: '#F4B400',
  },
  langFlag: {
    fontSize: 32,
  },
  langText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
})