const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Required for expo-router to locate the app directory
process.env.EXPO_ROUTER_APP_ROOT = path.join(__dirname, 'app');

const config = getDefaultConfig(__dirname);
module.exports = config;
