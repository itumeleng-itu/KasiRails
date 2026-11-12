import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/components/ui';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontSize: 22, fontWeight: '800' },
          headerStyle: { backgroundColor: colors.bg },
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ title: 'Kasi Rails' }} />
        <Stack.Screen name="pay" options={{ title: 'Pay' }} />
        <Stack.Screen name="receive" options={{ title: 'Receive money' }} />
        <Stack.Screen name="friends" options={{ title: 'Friends' }} />
        <Stack.Screen name="add-friend" options={{ title: 'Add a friend' }} />
        <Stack.Screen name="amount" options={{ title: '' }} />
      </Stack>
    </>
  );
}
