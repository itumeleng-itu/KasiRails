import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/components/auth-gate';
import { ArrowIcon, EyeIcon } from '@/components/icons';
import { BigButton, colors } from '@/components/ui';
import { usdcToZarCents } from '@kasi-rails/shared';

import { getHistory, type HistoryItem } from '@/lib/api';
import { readRate, readUsdcBalance } from '@/lib/chain';
import { formatDollars, formatRand, formatWhen, shortCode } from '@/lib/format';
import { getHideBalance, setHideBalance } from '@/lib/prefs';
import { getAddress } from '@/lib/wallet';

const HIDDEN = 'R ••••••';

interface Money {
  usdcAmount: bigint;
  zarCents: number;
  zarPerUsdc: number;
  liveRate: boolean;
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { username } = useAuth();
  const [balance, setBalance] = useState<Money | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const address = await getAddress().catch(() => null);
    if (!address) {
      setBalanceError('Could not open your account on this phone.');
      return;
    }
    await Promise.all([
      // Read straight from the chain so the balance shows even if the shop's server is unreachable.
      Promise.all([readUsdcBalance(address), readRate()])
        .then(([usdcAmount, rate]) => {
          setBalance({ usdcAmount, zarCents: usdcToZarCents(usdcAmount, rate.zarPerUsdc), zarPerUsdc: rate.zarPerUsdc, liveRate: rate.live });
          setBalanceError(null);
        })
        .catch(() => setBalanceError("Couldn't update your balance. Check your internet and pull down to try again.")),
      getHistory(address)
        .then((h) => (setHistory(h), setHistoryError(null)))
        .catch((err) => setHistoryError(err instanceof Error ? err.message : 'Could not load your history.')),
    ]);
  }, []);

  // Reload whenever Home comes back into view, e.g. after paying.
  useFocusEffect(
    useCallback(() => {
      getHideBalance().then(setHidden);
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleHidden = () => {
    setHidden((h) => {
      setHideBalance(!h);
      return !h;
    });
  };

  const header = (
    <View style={styles.header}>
      {username ? <Text style={styles.greeting}>Hi @{username}</Text> : null}
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.label}>Your money</Text>
          <Pressable
            onPress={toggleHidden}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}>
            <EyeIcon crossed={hidden} />
          </Pressable>
        </View>
        <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>
          {hidden ? HIDDEN : balance ? formatRand(balance.zarCents) : '…'}
        </Text>
        {!hidden && balance ? <Text style={styles.sub}>{formatDollars(balance.usdcAmount)}</Text> : null}
        {balance ? (
          <Text style={styles.rate}>
            {balance.liveRate ? 'Today' : 'Estimated'}: US$1 = R{balance.zarPerUsdc.toFixed(2)}
          </Text>
        ) : null}
        {balanceError ? <Text style={styles.error}>{balanceError}</Text> : null}
      </View>

      <View style={styles.actions}>
        <BigButton label="Pay" onPress={() => router.push('/pay')} style={styles.action} />
        <BigButton label="Receive" variant="secondary" onPress={() => router.push('/receive')} style={styles.action} />
      </View>

      <Text style={styles.sectionTitle}>Recent activity</Text>
    </View>
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          headerRight: () =>
            username ? (
              <Pressable onPress={() => router.push('/profile')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Profile">
                <View style={styles.profileButton}>
                  <Text style={styles.profileInitial}>{username.slice(0, 1).toUpperCase()}</Text>
                </View>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={history ?? []}
        keyExtractor={(item, i) => `${item.txHash}-${i}`}
        ListHeaderComponent={header}
        renderItem={({ item }) => <HistoryRow item={item} hidden={hidden} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            {history ? <Text style={styles.empty}>No history</Text> : null}
            {!history && historyError ? (
              <>
                <Text style={styles.empty}>No history to show</Text>
                <Text style={[styles.error, styles.centerText]}>{historyError}</Text>
              </>
            ) : null}
            {!history && !historyError ? <Text style={styles.empty}>Loading…</Text> : null}
          </View>
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </View>
  );
}

function HistoryRow({ item, hidden }: { item: HistoryItem; hidden: boolean }) {
  const name = item.label ?? (item.direction === 'in' ? 'Money received' : 'Money sent');
  const detail = item.label ? formatWhen(item.timestamp) : `${formatWhen(item.timestamp)} · ${shortCode(item.counterparty)}`;
  const incoming = item.direction === 'in';
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, incoming ? styles.inIcon : styles.outIcon]}>
        <ArrowIcon direction={item.direction} color={incoming ? colors.success : colors.fg} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {incoming ? name : item.label ? `Paid ${name}` : name}
        </Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Text style={[styles.rowAmount, incoming && { color: colors.success }]}>
        {hidden ? '••••' : `${incoming ? '+' : '−'}${formatRand(item.zarCents)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: 20, gap: 16 },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.fg },
  profileButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileInitial: { fontSize: 18, fontWeight: '900', color: colors.fg },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 18, color: colors.muted, fontWeight: '600' },
  amount: { fontSize: 52, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 17, color: colors.muted },
  rate: { fontSize: 15, color: colors.muted, marginTop: 8 },
  error: { fontSize: 16, color: colors.danger },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, minHeight: 64 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: colors.fg, marginTop: 8, textAlign: 'center' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 32 },
  empty: { fontSize: 18, color: colors.muted, textAlign: 'center' },
  centerText: { textAlign: 'center' },
  separator: { height: 1, backgroundColor: '#EEEEEE', marginLeft: 76 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inIcon: { backgroundColor: '#E3F6EC' },
  outIcon: { backgroundColor: colors.card },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '700', color: colors.fg },
  rowDetail: { fontSize: 14, color: colors.muted },
  rowAmount: { fontSize: 17, fontWeight: '800', color: colors.fg, fontVariant: ['tabular-nums'] },
});
