import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import type { Hex } from 'viem';
import { usdcToZarCents } from '@kasi-rails/shared';

import { useAuth } from '@/components/auth-gate';
import { Success } from '@/components/success';
import { Message, colors } from '@/components/ui';
import { readRate, readUsdcBalance } from '@/lib/chain';
import { getAddress } from '@/lib/wallet';

const POLL_MS = 3_000;
/** How long the "received" screen shows before going back to Home. */
const DONE_MS = 4_000;

/**
 * Watches the balance while the Receive code is on screen. Calls `onReceived` once,
 * with the amount, when the balance goes up (e.g. the shop sent a top-up).
 */
function useIncomingPayment(address: string | null, onReceived: (usdc: bigint) => void) {
  useEffect(() => {
    if (!address) return;
    let baseline: bigint | null = null;
    let stopped = false;
    const check = async () => {
      try {
        const balance = await readUsdcBalance(address as Hex);
        if (stopped) return;
        if (baseline === null) baseline = balance;
        else if (balance > baseline) {
          stopped = true;
          onReceived(balance - baseline);
        } else if (balance < baseline) baseline = balance; // spent elsewhere meanwhile
      } catch {
        // network blip: try again on the next tick
      }
    };
    check();
    const t = setInterval(() => { if (!stopped) check(); }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // onReceived is a fresh closure each render; the watch only depends on the address.
  }, [address]);
}

export default function Receive() {
  const { username } = useAuth();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<number | null>(null); // rand cents

  useIncomingPayment(address, async (usdc) => {
    const { zarPerUsdc } = await readRate();
    setReceived(usdcToZarCents(usdc, zarPerUsdc));
  });

  // After money arrives, show it briefly, then go back to Home (which refreshes the balance).
  useEffect(() => {
    if (received === null) return;
    const t = setTimeout(() => router.back(), DONE_MS);
    return () => clearTimeout(t);
  }, [received]);

  useEffect(() => {
    getAddress()
      .then(setAddress)
      .catch(() => setError('Could not load your code. Close the app and try again.'));
  }, []);

  if (received !== null) return <Success zarCents={received} message="Money received" onDone={() => router.back()} />;

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
      {address ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.waitingText}>Waiting for money…</Text>
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
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitingText: { fontSize: 17, color: colors.muted },
});
