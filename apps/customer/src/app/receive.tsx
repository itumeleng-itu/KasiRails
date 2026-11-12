import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Message, colors } from '@/components/ui';
import { getAddress } from '@/lib/wallet';

export default function Receive() {
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
      <View style={styles.qr}>
        {address ? <QRCode value={address} size={260} quietZone={12} /> : <ActivityIndicator size="large" color={colors.fg} />}
      </View>
      {address ? (
        <Text style={styles.code} selectable>
          {address.slice(0, 6)}…{address.slice(-4)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 },
  title: { fontSize: 26, fontWeight: '800', color: colors.fg, textAlign: 'center' },
  qr: { width: 284, height: 284, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 16 },
  code: { fontSize: 18, color: colors.muted, fontVariant: ['tabular-nums'] },
});
