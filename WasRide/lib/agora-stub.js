// Stub for react-native-agora — used in Expo Go / dev builds
// where the native module is not available.
module.exports = {
  createAgoraRtcEngine: () => ({
    initialize: () => {},
    enableAudio: () => {},
    joinChannel: () => {},
    leaveChannel: () => {},
    muteLocalAudioStream: () => {},
    release: () => {},
  }),
};
