import { useEffect } from "react";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { View, ActivityIndicator } from "react-native";

export default function ProfileIndex() {
  const router = useRouter();

  useEffect(() => { checkRole(); }, []);

  async function checkRole() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login' as never); return; }

      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();

      if (data?.role === 'driver') {
        router.replace('/profile-driver' as never);
      } else {
        router.replace('/profile-rider' as never);
      }
    } catch {
      router.replace('/login' as never);
    }
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color="#F4B400" />
    </View>
  );
}
