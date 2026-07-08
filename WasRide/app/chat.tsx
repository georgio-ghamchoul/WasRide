import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, Linking, Image, Alert, Vibration,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppState } from "@/lib/app-state";
import { sendLocalChatMessageNotification } from "@/lib/notifications";
import { recordNotification } from "@/lib/inbox";
import CallModal, { type CallModalRef } from "@/components/CallModal";

export default function ChatScreen() {
  const router = useRouter();
  const { rideId, otherUserId, otherName, otherImage, otherPhone, role } = useLocalSearchParams();
  const { locale, darkMode } = useAppState();
  const ar = locale === 'ar';

  const bg = darkMode ? '#111827' : '#fff';
  const cardBg = darkMode ? '#1F2937' : '#F3F4F6';
  const textColor = darkMode ? '#fff' : '#111827';
  const subtextColor = darkMode ? '#9CA3AF' : '#6B7280';
  const inputBg = darkMode ? '#1F2937' : '#F9FAFB';
  const borderColor = darkMode ? '#374151' : '#E5E7EB';

  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const callModalRef = useRef<CallModalRef>(null);
  // Ref so the realtime callback always sees the current user ID (avoids stale closure)
  const myIdRef = useRef<string | null>(null);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMyId(user.id);
    loadMessages();
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data);
  }

  function subscribeToMessages() {
    const channel = supabase
      .channel(`chat-${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new]);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
        // If the message is from the OTHER user → vibrate + notify
        if (payload.new.sender_id !== myIdRef.current) {
          Vibration.vibrate([0, 80, 60, 120]);
          const senderName = String(otherName || (ar ? 'رسالة جديدة' : 'New message'));
          sendLocalChatMessageNotification(senderName, String(payload.new.message || ''));
        }
      })
      .subscribe();
    // Store cleanup in a ref so it can be called on unmount
    return channel;
  }

  useEffect(() => {
    let channel: any;
    init().then(() => {
      channel = subscribeToMessages();
    });
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function sendMessage() {
    if (!text.trim() || !myId) return;
    setSending(true);
    const msg = text.trim();
    setText('');
    const { error } = await supabase.from('messages').insert({
      ride_id: rideId,
      sender_id: myId,
      message: msg,
    });
    if (error) {
      console.log('[Chat] sendMessage error:', error);
      setText(msg); // restore text so user doesn't lose it
      Alert.alert(
        ar ? 'خطأ' : 'Error',
        ar ? `فشل إرسال الرسالة: ${error.message}` : `Failed to send: ${error.message}`
      );
    } else if (otherUserId) {
      recordNotification({ userId: String(otherUserId), type: 'chat', title: 'New message', body: msg }).catch(() => {});
    }
    setSending(false);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const otherNameStr = String(otherName || (ar ? 'السائق' : 'Driver'));
  const otherImageStr = String(otherImage || '');
  const otherPhoneStr = String(otherPhone || '');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* HEADER */}
      <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: borderColor }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor }]}>‹</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          {otherImageStr ? (
            <Image source={{ uri: otherImageStr }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatarFallback, { backgroundColor: role === 'driver' ? '#16A34A' : '#F4B400' }]}>
              <Text style={styles.headerAvatarText}>{otherNameStr[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
          <View>
            <Text style={[styles.headerName, { color: textColor }]}>{otherNameStr}</Text>
            <Text style={[styles.headerRole, { color: subtextColor }]}>
              {role === 'driver' ? (ar ? '🏍 السائق' : '🏍 Your Driver') : (ar ? '👤 الراكب' : '👤 Your Rider')}
            </Text>
          </View>
        </View>

        {/* CALL BUTTON */}
        <Pressable
          onPress={() => callModalRef.current?.startCall()}
          style={[styles.callBtn, { backgroundColor: '#16A34A' }]}
        >
          <Text style={{ fontSize: 20 }}>📞</Text>
        </Pressable>
      </View>

      {/* MESSAGES */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
            <Text style={{ color: subtextColor, fontSize: 15, fontWeight: '600' }}>
              {ar ? 'ابدأ المحادثة مع السائق' : 'Start the conversation'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isMe = item.sender_id === myId;
          return (
            <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
              <View style={[
                styles.bubble,
                isMe
                  ? [styles.bubbleMe, { backgroundColor: '#F4B400' }]
                  : [styles.bubbleOther, { backgroundColor: cardBg }],
              ]}>
                <Text style={[styles.bubbleText, { color: isMe ? '#111827' : textColor }]}>
                  {item.message}
                </Text>
                <Text style={[styles.bubbleTime, { color: isMe ? '#92400E' : subtextColor }]}>
                  {formatTime(item.created_at)}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {/* INPUT BAR */}
      <View style={[styles.inputBar, { backgroundColor: cardBg, borderTopColor: borderColor }]}>
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, borderColor, color: textColor }]}
          placeholder={ar ? 'اكتب رسالة...' : 'Type a message...'}
          placeholderTextColor={subtextColor}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          textAlign={ar ? 'right' : 'left'}
          onSubmitEditing={sendMessage}
        />
        <Pressable
          style={[styles.sendBtn, { opacity: text.trim() ? 1 : 0.4 }]}
          onPress={sendMessage}
          disabled={!text.trim() || sending}
        >
          <Text style={{ fontSize: 20 }}>➤</Text>
        </Pressable>
      </View>

      {/* ── IN-APP CALL ── */}
      {myId && otherUserId && rideId && (
        <CallModal
          ref={callModalRef}
          rideId={String(rideId)}
          myId={myId}
          myName=""
          otherUserId={String(otherUserId)}
          otherName={otherNameStr || (role === 'driver' ? (ar ? 'السائق' : 'Driver') : (ar ? 'الراكب' : 'Rider'))}
          locale={locale}
          darkMode={darkMode}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 56,
    paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, gap: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 34, fontWeight: '300', lineHeight: 38 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 42, height: 42, borderRadius: 21 },
  headerAvatarFallback: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontSize: 18, fontWeight: '900', color: '#111827' },
  headerName: { fontSize: 16, fontWeight: '800' },
  headerRole: { fontSize: 12, fontWeight: '600' },
  callBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  msgRow: { flexDirection: 'row', marginBottom: 4 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  bubbleTime: { fontSize: 10, fontWeight: '600', alignSelf: 'flex-end' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, paddingBottom: 32, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 15, maxHeight: 100,
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#F4B400',
    alignItems: 'center', justifyContent: 'center',
  },
});
