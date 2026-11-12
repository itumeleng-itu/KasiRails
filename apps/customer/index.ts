// Polyfill crypto.getRandomValues before anything else loads (viem needs it to create keys).
import 'react-native-get-random-values';
import 'expo-router/entry';
