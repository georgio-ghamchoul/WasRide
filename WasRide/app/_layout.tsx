import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppStateProvider } from "@/lib/app-state";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";
import * as Sentry from "@sentry/react-native";

// Crash & error monitoring. DSN comes from .env so it stays out of git.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  enabled: !__DEV__,
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { setIsAdmin } = useAppState();
  const [session, setSession] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [routed, setRouted] = useState(false);

  // In-app admin broadcast notifications
  const roleRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [banner, setBanner] = useState<{ title?: string; body: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setLoaded(true);
        const phone = session?.user?.phone?.replace(/\D/g, '') || '';
        if (phone.endsWith('71073230')) setIsAdmin(true);
      })
      .catch(() => {
        // Bad/expired token — wipe it so Supabase stops retrying on every launch
        supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        setSession(null);
        setLoaded(true);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const phone = (session.user.phone ?? '').replace(/\D/g, '');
        if (phone.endsWith('71073230')) setIsAdmin(true);
      } else {
        setIsAdmin(false);
        // Bad/expired token (refresh failed). Clear it — but DEFER the auth call:
        // calling supabase.auth.* synchronously inside this callback deadlocks the
        // auth lock and freezes the next sign-in (logout → login stuck on loading).
        if (_event === 'TOKEN_REFRESHED' && !session) {
          setTimeout(() => { supabase.auth.signOut({ scope: 'local' }).catch(() => {}); }, 0);
        }
      }
      setSession(session);
      setRouted(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loaded || !session) return;
    const currentRoute = segments[0] as string;
    if (!routed && !['driver-pending', 'driver-apply'].includes(currentRoute)) {
      setRouted(true);
      checkUserRole();
    }
  }, [session, loaded, segments, routed]);

  useEffect(() => {
    if (!loaded || session) return;
    const publicRoutes = ['login', 'signup', 'driver-apply', 'driver-pending', 'language-select'];
    if (!publicRoutes.includes(segments[0] as string)) {
      checkFirstLaunch();
    }
  }, [session, loaded, segments]);

  // Track the signed-in user's role so we know which broadcasts apply to them.
  useEffect(() => {
    const uid = session?.user?.id;
    userIdRef.current = uid ?? null;
    if (!uid) { roleRef.current = null; return; }
    supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
      .then(({ data }) => { roleRef.current = data?.role ?? 'rider'; }, () => { roleRef.current = 'rider'; });
  }, [session]);

  // Listen for admin broadcasts and show an in-app banner to the matching audience.
  useEffect(() => {
    const channel = supabase
      .channel('admin-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as any;
        const role = roleRef.current;
        if (!role || role === 'admin') return;
        // Targeted row: only banner it for the intended recipient.
        if (n.user_id) {
          if (n.user_id === userIdRef.current) setBanner({ title: n.title || undefined, body: n.body });
          return;
        }
        // Broadcast: match by audience.
        const match =
          n.audience === 'all' ||
          (n.audience === 'drivers' && role === 'driver') ||
          (n.audience === 'riders' && role === 'rider');
        if (match) setBanner({ title: n.title || undefined, body: n.body });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Auto-dismiss the banner after a few seconds.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 7000);
    return () => clearTimeout(t);
  }, [banner]);

  async function checkFirstLaunch() {
    try {
      const lang = await AsyncStorage.getItem('language');
      router.replace(lang ? '/login' : '/language-select' as never);
    } catch {
      router.replace('/login' as never);
    }
  }

  async function checkUserRole() {
    try {
      // Use getSession (local cache, no network) — never fails with "No user found"
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const cleanPhone = (user.phone || '').replace(/\D/g, '');
      const isAdminUser = cleanPhone.endsWith('71073230');

      if (isAdminUser) {
        setIsAdmin(true);
        router.replace('/' as never);
        return;
      }

      // Non-admin: check role from profiles table
      const { data: profile } = await supabase
        .from('profiles').select('role, approval_status, full_name').eq('id', user.id).maybeSingle();

      if (profile?.role === 'driver') {
        if (profile.approval_status === 'pending') {
          router.replace('/driver-pending' as never);
        } else {
          router.replace('/driver/home' as never);
        }
        return;
      }

      // Rider without a name yet (e.g. brand-new number that signed in via the
      // login screen) must complete their profile before they can order.
      if (!profile?.full_name || !profile.full_name.trim()) {
        router.replace('/complete-profile' as never);
        return;
      }

      router.replace('/' as never);
    } catch (e) {
      console.log('Role check error:', e);
    }
  }

  return (
    <>
      {children}
      {banner && (
        <Pressable style={nb.wrap} onPress={() => setBanner(null)}>
          <Text style={nb.icon}>📣</Text>
          <View style={{ flex: 1 }}>
            {banner.title ? <Text style={nb.title} numberOfLines={1}>{banner.title}</Text> : null}
            <Text style={nb.body} numberOfLines={4}>{banner.body}</Text>
          </View>
          <Text style={nb.close}>✕</Text>
        </Pressable>
      )}
    </>
  );
}

const nb = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 50, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1E293B', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#F4B400',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
    zIndex: 9999,
  },
  icon:  { fontSize: 22 },
  title: { color: '#F4B400', fontWeight: '900', fontSize: 14, marginBottom: 2 },
  body:  { color: '#F1F5F9', fontWeight: '600', fontSize: 13, lineHeight: 18 },
  close: { color: '#94A3B8', fontSize: 16, fontWeight: '700', paddingLeft: 4 },
});

function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
  }));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AppStateProvider>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <AuthGate>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="login" />
                <Stack.Screen name="signup" />
                <Stack.Screen name="profile-setup" />
                <Stack.Screen name="complete-profile" />
                <Stack.Screen name="profile/index" />
                <Stack.Screen name="profile-rider" />
                <Stack.Screen name="profile-driver" />
                <Stack.Screen name="driver-apply" />
                <Stack.Screen name="driver-pending" />
                <Stack.Screen name="confirm-ride" />
                <Stack.Screen name="delivery-details" />
                <Stack.Screen name="driver-list" />
                <Stack.Screen name="waiting" />
                <Stack.Screen name="tracking" />
                <Stack.Screen name="trip-rating" />
                <Stack.Screen name="request-sent" />
                <Stack.Screen name="admin" />
                <Stack.Screen name="admin-web" />
                <Stack.Screen name="chat" />
                <Stack.Screen name="notifications" />
                <Stack.Screen name="support" />
                <Stack.Screen name="ride-history" />
                <Stack.Screen name="driver/home" />
                <Stack.Screen name="driver/trip" />
                <Stack.Screen name="driver-profile/[id]" />
                <Stack.Screen name="oauth/callback" />
                <Stack.Screen name="language-select" />
              </Stack>
            </AuthGate>
            <StatusBar style="auto" />
          </SafeAreaProvider>
        </AppStateProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);