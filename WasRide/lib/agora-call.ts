// Real Agora RTC engine — active only in EAS / native builds.
// In Expo Go set EXPO_PUBLIC_USE_STUB_AGORA=true (already in .env) so the
// native module import is skipped and the call UI falls back gracefully.
// In an EAS dev build or production APK set it to false.

const APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID ?? '';
const USE_STUB = process.env.EXPO_PUBLIC_USE_STUB_AGORA !== 'false';

let engine: any = null; // IRtcEngine from react-native-agora

// Lazy-init the engine so we never crash on import in Expo Go.
async function getEngine(): Promise<any | null> {
  if (USE_STUB || !APP_ID) return null;
  if (engine) return engine;
  try {
    const {
      createAgoraRtcEngine,
      ChannelProfileType,
    } = await import('react-native-agora' as any);

    const rtc = createAgoraRtcEngine();
    rtc.initialize({
      appId: APP_ID,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    rtc.enableAudio();
    // Optimize for voice chat (low latency, noise suppression on)
    rtc.setAudioProfile(0 /* SpeechStandard */, 1 /* ChatRoom */);
    engine = rtc;
    return engine;
  } catch (e) {
    console.warn('[Agora] Native module not available in this environment:', e);
    return null;
  }
}

/**
 * Join the Agora RTC channel for this ride.
 * Channel name = rideId (unique per trip).
 * Token = '' works when the Agora App Certificate is DISABLED (test mode).
 * If you enable the App Certificate you must generate a token server-side.
 */
export async function joinCall(rideId: string, _userId: string): Promise<void> {
  const rtc = await getEngine();
  if (!rtc) return;
  try {
    await rtc.joinChannel(
      '', // token — leave empty while App Certificate is disabled
      rideId, // channelId — must be identical on both devices
      0, // uid — 0 lets Agora auto-assign a unique numeric ID
      {
        clientRoleType: 1, // ClientRoleBroadcaster
        autoSubscribeAudio: true,
        publishMicrophoneTrack: true,
      }
    );
  } catch (e) {
    console.warn('[Agora] joinChannel error:', e);
  }
}

export function muteLocalAudio(muted: boolean): void {
  engine?.muteLocalAudioStream(muted);
}

export function leaveCall(): void {
  if (engine) {
    try { engine.leaveChannel(); } catch (_) {}
    try { engine.release(); } catch (_) {}
    engine = null;
  }
}

export async function setSpeakerphone(on: boolean): Promise<void> {
  if (engine) {
    try { engine.setEnableSpeakerphone(on); } catch (_) {}
    return;
  }
  // Fallback for Expo Go via expo-audio
  try {
    const { setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      staysActiveInBackground: true,
      shouldRouteThroughEarpiece: !on,
    } as any);
  } catch (_) {}
}
