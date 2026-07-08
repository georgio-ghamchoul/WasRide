import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// Custom storage that silently clears bad tokens instead of crashing
const safeStorage = {
  getItem: async (key: string) => {
    try {
      return await AsyncStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      await AsyncStorage.setItem(key, value)
    } catch {}
  },
  removeItem: async (key: string) => {
    try {
      await AsyncStorage.removeItem(key)
    } catch {}
  },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : safeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})