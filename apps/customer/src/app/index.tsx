import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { BigButton, Message, colors } from '@/components/ui';
import { getBalance, type Balance } from '@/lib/api';
import { formatDollars, formatRand } from '@/lib/format';
import { getAddress } from '@/lib/wallet';

export default function Home() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const address = await getAddress();
      setBalance(await getBalance(address));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your balance.');
    }
  }, []);

  // Reload whenever Home comes back into view, e.g. after paying.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.card}>
        <Text style={styles.label}>Your money</Text>
        <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>
          {balance ? formatRand(balance.zarCents) : '…'}
        </Text>
        {balance ? <Text style={styles.sub}>{formatDollars(balance.usdcAmount)}</Text> : null}
        <Text style={styles.hint}>Pull down to refresh</Text>
      </View>

      {error ? <Message title="Couldn't update" body={error} tone="danger" /> : null}

      <View style={styles.actions}>
        <BigButton label="Pay" onPress={() => router.push('/pay')} />
        <BigButton label="Receive" variant="secondary" onPress={() => router.push('/receive')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, gap: 24 },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  label: { fontSize: 20, color: colors.muted, fontWeight: '600' },
  amount: { fontSize: 64, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 18, color: colors.muted },
  hint: { fontSize: 14, color: colors.muted, marginTop: 8 },
  actions: { gap: 16, marginTop: 'auto' },
});
