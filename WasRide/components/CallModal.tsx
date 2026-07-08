import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, Vibration, Animated, Easing,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { joinCall, leaveCall, muteLocalAudio, setSpeakerphone } from '@/lib/agora-call';

export type CallState = 'idle' | 'outgoing' | 'incoming' | 'active';

interface Props {
  rideId: string;
  myId: string;
  myName: string;
  otherUserId: string;
  otherName: string;
  locale?: string;
  darkMode?: boolean;
}

export interface CallModalRef {
  startCall: () => void;
}

const CallModal = forwardRef<CallModalRef, Props>(
  ({ rideId, myId, myName, otherUserId, otherName, locale = 'en', darkMode = true }, ref) => {
    const ar = locale === 'ar';
    const [callState, setCallState] = useState<CallState>('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeaker, setIsSpeaker] = useState(false);
    const [duration, setDuration] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    // Persistent outbound signaling channel — avoids the Supabase channel-cache
    // race where calling supabase.channel(sameName) within 3 s returns the cached
    // instance so subscribe() never fires and the signal is silently dropped.
    const sigChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const sigChReadyRef = useRef(false);

    const cardBg = darkMode ? '#1F2937' : '#FFFFFF';
    const nameColor = darkMode ? '#FFFFFF' : '#111827';
    const muteBg = darkMode ? '#374151' : '#E5E7EB';
    const muteActiveBg = darkMode ? '#1F2937' : '#F3F4F6';

    useImperativeHandle(ref, () => ({
      startCall: () => initiateCall(),
    }));

    useEffect(() => {
      if (callState === 'incoming' || callState === 'outgoing') {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          ])
        ).start();
      } else {
        pulseAnim.setValue(1);
      }
    }, [callState]);

    useEffect(() => {
      if (callState === 'incoming') {
        Vibration.vibrate([0, 500, 1000], true);
        return () => Vibration.cancel();
      } else {
        Vibration.cancel();
      }
    }, [callState]);

    useEffect(() => {
      if (callState === 'active') {
        setDuration(0);
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
        setDuration(0);
      }
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [callState]);

    // Persistent outbound channel — created once, reused for all signals we send.
    useEffect(() => {
      if (!rideId || !myId || !otherUserId) return;
      sigChReadyRef.current = false;
      const ch = supabase.channel('call_signal_' + rideId + '_' + otherUserId, {
        config: { broadcast: { ack: false } },
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') { sigChRef.current = ch; sigChReadyRef.current = true; }
      });
      return () => {
        sigChRef.current = null;
        sigChReadyRef.current = false;
        supabase.removeChannel(ch);
      };
    }, [rideId, myId, otherUserId]);

    // Inbound channel — listens for signals addressed to ME.
    useEffect(() => {
      if (!rideId || !myId) return;
      const ch = supabase
        .channel('call_signal_' + rideId + '_' + myId)
        .on('broadcast', { event: 'call_invite' }, (msg) => {
          if (msg.payload?.callerId === otherUserId) {
            setCallState('incoming');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        })
        .on('broadcast', { event: 'call_accepted' }, (msg) => {
          if (msg.payload?.receiverId === myId) {
            setCallState('active');
            joinCall(rideId, myId).catch(console.error);
          }
        })
        .on('broadcast', { event: 'call_declined' }, (msg) => {
          if (msg.payload?.receiverId === myId) {
            setCallState('idle');
          }
        })
        .on('broadcast', { event: 'call_ended' }, () => {
          endCall(false);
        })
        .subscribe();
      return () => { supabase.removeChannel(ch); };
    }, [rideId, myId, otherUserId]);

    function sendSignal(event: string, extra: Record<string, any> = {}) {
      const payload = { callerId: myId, receiverId: otherUserId, ...extra };
      if (sigChReadyRef.current && sigChRef.current) {
        sigChRef.current.send({ type: 'broadcast', event, payload });
      } else {
        // Fallback with a unique name so it doesn't collide with the persistent channel
        const ch = supabase.channel(
          'call_sig_fb_' + rideId + '_' + otherUserId + '_' + Date.now(),
          { config: { broadcast: { ack: false } } }
        );
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            ch.send({ type: 'broadcast', event, payload });
            setTimeout(() => supabase.removeChannel(ch), 4000);
          }
        });
      }
    }

    function initiateCall() {
      setCallState('outgoing');
      sendSignal('call_invite');
    }

    function acceptIncomingCall() {
      setCallState('active');
      joinCall(rideId, myId).catch(console.error);
      sendSignal('call_accepted', { callerId: otherUserId, receiverId: myId });
    }

    function declineIncomingCall() {
      setCallState('idle');
      sendSignal('call_declined', { callerId: otherUserId, receiverId: myId });
    }

    function endCall(notifyOther = true) {
      if (notifyOther) sendSignal('call_ended');
      leaveCall();
      setSpeakerphone(false).catch(() => {});
      setCallState('idle');
      setIsMuted(false);
      setIsSpeaker(false);
    }

    function toggleMute() {
      const next = !isMuted;
      setIsMuted(next);
      muteLocalAudio(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    function toggleSpeaker() {
      const next = !isSpeaker;
      setIsSpeaker(next);
      setSpeakerphone(next).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    function formatDuration(secs: number) {
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      return `${m}:${s}`;
    }

    if (callState === 'idle') return null;

    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: cardBg }]}>

            <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {otherName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            </Animated.View>

            <Text style={[styles.name, { color: nameColor }]}>{otherName}</Text>

            <Text style={styles.status}>
              {callState === 'incoming'
                ? (ar ? '📲 مكالمة واردة...' : '📲 Incoming call...')
                : callState === 'outgoing'
                ? (ar ? '📞 جارٍ الاتصال...' : '📞 Calling...')
                : formatDuration(duration)}
            </Text>

            {callState === 'incoming' && (
              <View style={styles.row}>
                <Pressable style={styles.declineBtn} onPress={declineIncomingCall}>
                  <Text style={styles.btnIcon}>📵</Text>
                  <Text style={styles.btnLabel}>{ar ? 'رفض' : 'Decline'}</Text>
                </Pressable>
                <Pressable style={styles.acceptBtn} onPress={acceptIncomingCall}>
                  <Text style={styles.btnIcon}>📞</Text>
                  <Text style={styles.btnLabel}>{ar ? 'قبول' : 'Accept'}</Text>
                </Pressable>
              </View>
            )}

            {callState === 'outgoing' && (
              <Pressable style={styles.hangupBtn} onPress={() => { setCallState('idle'); sendSignal('call_ended'); }}>
                <Text style={styles.btnIcon}>📵</Text>
                <Text style={styles.btnLabel}>{ar ? 'إلغاء' : 'Cancel'}</Text>
              </Pressable>
            )}

            {callState === 'active' && (
              <View style={styles.row}>
                <Pressable style={[styles.muteBtn, { backgroundColor: isMuted ? muteActiveBg : muteBg }, isMuted && styles.muteBtnActiveBorder]} onPress={toggleMute}>
                  <Text style={styles.btnIcon}>{isMuted ? '🔇' : '🎙'}</Text>
                  <Text style={[styles.btnLabel, { color: isMuted ? '#F4B400' : '#9CA3AF' }]}>
                    {isMuted ? (ar ? 'كتم' : 'Muted') : (ar ? 'صوت' : 'Mic')}
                  </Text>
                </Pressable>
                <Pressable style={[styles.muteBtn, { backgroundColor: isSpeaker ? muteActiveBg : muteBg }, isSpeaker && styles.muteBtnActiveBorder]} onPress={toggleSpeaker}>
                  <Text style={styles.btnIcon}>🔊</Text>
                  <Text style={[styles.btnLabel, { color: isSpeaker ? '#F4B400' : '#9CA3AF' }]}>
                    {ar ? 'سماعة' : 'Speaker'}
                  </Text>
                </Pressable>
                <Pressable style={styles.hangupBtn} onPress={() => endCall(true)}>
                  <Text style={styles.btnIcon}>📵</Text>
                  <Text style={styles.btnLabel}>{ar ? 'إنهاء' : 'End'}</Text>
                </Pressable>
              </View>
            )}

          </View>
        </View>
      </Modal>
    );
  }
);

export default CallModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    width: 300, borderRadius: 28,
    padding: 32, alignItems: 'center', gap: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 20,
  },
  avatarRing: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(244,180,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#F4B400', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 36, fontWeight: '900', color: '#111827' },
  name: { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  status: { fontSize: 15, color: '#9CA3AF', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 24, marginTop: 8 },
  declineBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  acceptBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#16A34A',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  hangupBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8,
  },
  muteBtn: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  muteBtnActiveBorder: { borderWidth: 2, borderColor: '#F4B400' },
  btnIcon: { fontSize: 24 },
  btnLabel: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
