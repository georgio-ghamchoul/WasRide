import { View, Text, Pressable, StyleSheet, Linking, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useAppState } from "@/lib/app-state";

export default function SupportScreen() {
  const router = useRouter();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#fff';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const cardBg = darkMode ? '#1F2937' : '#F9FAFB';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  const options = [
    {
      icon: '📞',
      title: ar ? 'اتصل بنا' : 'Call Us',
      sub: ar ? 'متاح من 8 صباحاً - 10 مساءً' : 'Available 8AM - 10PM',
      color: '#16A34A',
      onPress: () => Linking.openURL('tel:+96171073230'),
    },
    {
      icon: '💬',
      title: ar ? 'واتساب' : 'WhatsApp',
      sub: ar ? 'راسلنا في أي وقت' : 'Message us anytime',
      color: '#25D366',
      onPress: () => Linking.openURL('https://wa.me/96171073230'),
    },
    {
      icon: '📧',
      title: ar ? 'البريد الإلكتروني' : 'Email Us',
      sub: 'support@waslride.com',
      color: '#F4B400',
      onPress: () => Linking.openURL('mailto:support@waslride.com'),
    },
    {
      icon: '🌐',
      title: ar ? 'موقعنا الإلكتروني' : 'Visit Website',
      sub: 'www.waslride.com',
      color: '#2563EB',
      onPress: () => Linking.openURL('https://waslride.com'),
    },
  ];

  const faqs = ar
    ? [
        { q: 'كيف أبلغ عن مشكلة في الرحلة؟', a: 'تواصل معنا عبر واتساب أو الهاتف وسنحل المشكلة فوراً.' },
        { q: 'كيف أسترد أغراضي المنسية؟', a: 'تواصل معنا خلال 24 ساعة وسنساعدك في التواصل مع السائق.' },
        { q: 'كيف أُلغي طلباً؟', a: 'يمكنك إلغاء الطلب من شاشة التتبع قبل وصول السائق.' },
        { q: 'هل الدفع نقداً فقط؟', a: 'حالياً ندعم الدفع النقدي فقط.' },
      ]
    : [
        { q: 'How do I report a trip issue?', a: 'Contact us via WhatsApp or phone and we\'ll resolve it immediately.' },
        { q: 'How do I recover lost items?', a: 'Contact us within 24 hours and we\'ll help you reach the driver.' },
        { q: 'How do I cancel a request?', a: 'You can cancel from the tracking screen before the driver arrives.' },
        { q: 'Is payment cash only?', a: 'Currently we only support cash payments.' },
      ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>

      {/* HEADER */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={[styles.back, { color: textColor }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: textColor }]}>{ar ? 'خدمة العملاء' : 'Customer Support'}</Text>
        <View style={{ width: 30 }} />
      </View>

      {/* HERO */}
      <View style={[styles.hero, { backgroundColor: cardBg, borderColor }]}>
        <Text style={{ fontSize: 48, marginBottom: 10 }}>🎧</Text>
        <Text style={[styles.heroTitle, { color: textColor }]}>
          {ar ? 'كيف يمكننا مساعدتك؟' : 'How can we help you?'}
        </Text>
        <Text style={[styles.heroSub, { color: subtextColor }]}>
          {ar ? 'فريقنا جاهز للمساعدة في أي وقت' : 'Our team is ready to help anytime'}
        </Text>
      </View>

      {/* CONTACT OPTIONS */}
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        {ar ? 'تواصل معنا' : 'Contact Us'}
      </Text>
      <View style={styles.optionsGrid}>
        {options.map((opt) => (
          <Pressable key={opt.title} onPress={opt.onPress} style={{ width: '48%' }}>
            <View style={[styles.optionCard, { backgroundColor: cardBg, borderColor }]}>
              <View style={[styles.optionIcon, { backgroundColor: opt.color + '20' }]}>
                <Text style={{ fontSize: 28 }}>{opt.icon}</Text>
              </View>
              <Text style={[styles.optionTitle, { color: textColor }]}>{opt.title}</Text>
              <Text style={[styles.optionSub, { color: subtextColor }]}>{opt.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* FAQ */}
      <Text style={[styles.sectionTitle, { color: textColor, marginTop: 8 }]}>
        {ar ? 'الأسئلة الشائعة' : 'FAQ'}
      </Text>
      <View style={{ gap: 10 }}>
        {faqs.map((faq, i) => (
          <View key={i} style={[styles.faqCard, { backgroundColor: cardBg, borderColor }]}>
            <Text style={[styles.faqQ, { color: textColor }]}>❓ {faq.q}</Text>
            <Text style={[styles.faqA, { color: subtextColor }]}>{faq.a}</Text>
          </View>
        ))}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, marginTop: 40 },
  back: { fontSize: 36, fontWeight: '300', lineHeight: 40 },
  title: { fontSize: 20, fontWeight: '900' },
  hero: { borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1, marginBottom: 28 },
  heroTitle: { fontSize: 20, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  heroSub: { fontSize: 14, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  optionCard: { borderRadius: 18, padding: 18, alignItems: 'center', gap: 8, borderWidth: 1 },
  optionIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  optionSub: { fontSize: 11, textAlign: 'center', fontWeight: '500' },
  faqCard: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 8 },
  faqQ: { fontSize: 14, fontWeight: '700' },
  faqA: { fontSize: 13, lineHeight: 20 },
});
