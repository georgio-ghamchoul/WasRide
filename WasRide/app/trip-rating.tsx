import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, Image, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";

const LABELS = {
  en: ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'],
  ar: ['سيء جداً', 'سيء', 'مقبول', 'جيد', 'ممتاز'],
};

export default function TripRating() {
  const router = useRouter();
  const { rideId, toUserId, toRole, autoOnline } = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const cardBg = darkMode ? '#1F2937' : '#F9FAFB';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [personData, setPersonData] = useState<any>(null);
  const [loadingPerson, setLoadingPerson] = useState(true);

  const isRatingDriver = toRole === 'driver';

  useEffect(() => {
    loadPersonData();
  }, []);

  async function loadPersonData() {
    if (!toUserId) return;
    setLoadingPerson(true);
    try {
      const { data } = await supabase
        .from('public_profiles')
        .select('full_name, average_rating')
        .eq('id', toUserId as string)
        .maybeSingle();
      if (data) {
        const bucket = isRatingDriver ? 'driver-images' : 'profile-images';
        const path   = isRatingDriver ? `drivers/${toUserId}.jpg` : `riders/${toUserId}.jpg`;
        const photoUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
        setPersonData({ ...data, display_image: photoUrl });
      }
    } catch (_) {}
    setLoadingPerson(false);
  }

  async function submitRating() {
    if (rating === 0) return Alert.alert(ar ? 'خطأ' : 'Error', ar ? 'اختر عدد النجوم' : 'Please select a star rating');
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if a rating already exists for this pair — update it if so, insert if not.
      // This avoids needing a unique DB constraint and never blocks with "already rated".
      const { data: existing } = await supabase
        .from('ratings')
        .select('id')
        .eq('from_user_id', user.id)
        .eq('to_user_id', toUserId as string)
        .eq('to_role', toRole as string)
        .maybeSingle();

      let error;
      if (existing?.id) {
        ({ error } = await supabase
          .from('ratings')
          .update({ rating })
          .eq('id', existing.id));
      } else {
        ({ error } = await supabase.from('ratings').insert({
          from_user_id: user.id,
          to_user_id: toUserId,
          to_role: toRole,
          rating,
        }));
      }
      if (error) throw error;

      // Update average rating on the person's record
      const { data: allRatings } = await supabase.from('ratings')
        .select('rating').eq('to_user_id', toUserId).eq('to_role', toRole);
      if (allRatings?.length) {
        const avg = allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length;
        await supabase.from('profiles')
          .update({ average_rating: Number(avg.toFixed(1)) })
          .eq('id', toUserId as string);
      }

      Alert.alert(
        ar ? '🙏 شكراً!' : '🙏 Thank you!',
        ar ? 'تم إرسال تقييمك بنجاح' : 'Your rating has been submitted'
      );
      if (isRatingDriver) {
        router.replace('/' as never);
      } else {
        router.replace({ pathname: '/driver/home', params: { autoOnline: autoOnline || 'false' } } as never);
      }
    } catch (err: any) {
      Alert.alert(ar ? 'خطأ' : 'Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  const displayName = personData?.full_name || (isRatingDriver ? (ar ? 'السائق' : 'Driver') : (ar ? 'الراكب' : 'Rider'));
  const displayImage = personData?.display_image;
  const activeRating = hovered || rating;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>

      {/* HEADER */}
      <Text style={[styles.topLabel, { color: subtextColor }]}>
        {isRatingDriver ? (ar ? 'قيّم السائق' : 'Rate your driver') : (ar ? 'قيّم الراكب' : 'Rate your rider')}
      </Text>

      {/* PERSON CARD */}
      <View style={[styles.personCard, { backgroundColor: cardBg, borderColor }]}>
        {loadingPerson ? (
          <ActivityIndicator color="#F4B400" />
        ) : (
          <>
            {displayImage ? (
              <Image source={{ uri: displayImage }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: isRatingDriver ? '#16A34A' : '#F4B400' }]}>
                <Text style={styles.avatarInitial}>
                  {displayName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <Text style={[styles.personName, { color: textColor }]}>{displayName}</Text>
            {isRatingDriver && personData?.average_rating ? (
              <Text style={{ color: subtextColor, fontSize: 13 }}>
                ⭐ {Number(personData.average_rating).toFixed(1)} {ar ? 'تقييم سابق' : 'previous rating'}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* STARS */}
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            onPressIn={() => setHovered(n)}
            onPressOut={() => setHovered(0)}
          >
            <Text style={[styles.star, { opacity: n <= activeRating ? 1 : 0.25 }]}>⭐</Text>
          </Pressable>
        ))}
      </View>

      {/* LABEL */}
      {activeRating > 0 && (
        <Text style={[styles.ratingLabel, { color: textColor }]}>
          {ar ? LABELS.ar[activeRating - 1] : LABELS.en[activeRating - 1]}
        </Text>
      )}


      {/* SUBMIT */}
      <Pressable style={[styles.submitBtn, rating === 0 && { opacity: 0.5 }]} onPress={submitRating} disabled={loading || rating === 0}>
        <Text style={styles.submitText}>
          {loading ? (ar ? 'جارٍ الإرسال...' : 'Submitting...') : (ar ? '⭐ إرسال التقييم' : '⭐ Submit Rating')}
        </Text>
      </Pressable>

      {/* SKIP */}
      <Pressable
        onPress={() => {
          if (isRatingDriver) {
            router.replace('/' as never);
          } else {
            router.replace({ pathname: '/driver/home', params: { autoOnline: autoOnline || 'false' } } as never);
          }
        }}
        style={{ marginTop: 12 }}
      >
        <Text style={[styles.skipText, { color: subtextColor }]}>
          {ar ? 'تخطي' : 'Skip for now'}
        </Text>
      </Pressable>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topLabel: { fontSize: 14, fontWeight: '700', marginBottom: 20, letterSpacing: 0.5 },
  personCard: {
    alignItems: 'center', gap: 10, padding: 24, borderRadius: 24,
    borderWidth: 1, width: '100%', marginBottom: 32,
  },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 36, fontWeight: '900', color: '#111827' },
  personName: { fontSize: 22, fontWeight: '900' },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  star: { fontSize: 44 },
  ratingLabel: { fontSize: 18, fontWeight: '800', marginBottom: 20 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 },
  tag: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  commentInput: {
    width: '100%', borderWidth: 1, borderRadius: 16, padding: 14,
    fontSize: 15, marginBottom: 20, minHeight: 80, textAlignVertical: 'top',
  },
  submitBtn: { backgroundColor: '#F4B400', padding: 18, borderRadius: 18, width: '100%', alignItems: 'center' },
  submitText: { color: '#111827', fontWeight: '900', fontSize: 17 },
  skipText: { fontSize: 14, fontWeight: '600' },
});
