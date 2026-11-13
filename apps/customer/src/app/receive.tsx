import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useAuth } from '@/components/auth-gate';
import { Message, colors } from '@/components/ui';
import { getAddress } from '@/lib/wallet';

export default function Receive() {
  const { username } = useAuth();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAddress()
      .then(setAddress)
      .catch(() => setError('Could not load your code. Close the app and try again.'));
  }, []);

  if (error) return <View style={styles.container}><Message title="Something went wrong" body={error} tone="danger" /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Show this to the shop to top up</Text>
      {username ? <Text style={styles.username}>@{username}</Text> : null}
      <View style={styles.qr}>
        {address ? <QRCode value={address} size={260} quietZone={12} /> : <ActivityIndicator size="large" color={colors.fg} />}
      </View>
      {address ? (
        <View style={styles.codeBox}>
          <Text style={styles.code} selectable>
            {address}
          </Text>
          <Text style={styles.codeHint}>Press and hold to copy</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 },
  title: { fontSize: 26, fontWeight: '800', color: colors.fg, textAlign: 'center' },
  username: { fontSize: 22, fontWeight: '700', color: colors.primary },
  qr: { width: 284, height: 284, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 16 },
  codeBox: { alignItems: 'center', gap: 4 },
  code: { fontSize: 15, color: colors.fg, textAlign: 'center' },
  codeHint: { fontSize: 13, color: colors.muted },
});
