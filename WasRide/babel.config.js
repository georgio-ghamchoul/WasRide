module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Explicitly added because pnpm's isolated module resolution prevents
      // babel-preset-expo from auto-detecting expo-router via hasModule()
      require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
      'react-native-reanimated/plugin',
    ],
  };
};