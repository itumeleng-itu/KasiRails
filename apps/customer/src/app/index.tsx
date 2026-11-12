import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendsSheet } from '@/components/friends-sheet';
import { ArrowIcon, EyeIcon, PersonIcon } from '@/components/icons';
import { BigButton, colors } from '@/components/ui';
import { getBalance, getHistory, type Balance, type HistoryItem } from '@/lib/api';
import { formatDollars, formatRand, formatWhen, shortCode } from '@/lib/format';
import { findFriend, getHideBalance, listFriends, setHideBalance, type Friend } from '@/lib/friends';
import { getAddress } from '@/lib/wallet';

const HIDDEN = 'R ••••••';

export default function Home() {
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [hidden, setHidden] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    const address = await getAddress().catch(() => null);
    if (!address) {
      setBalanceError('Could not open your account on this phone.');
      return;
    }
    await Promise.all([
      getBalance(address)
        .then((b) => (setBalance(b), setBalanceError(null)))
        .catch((err) => setBalanceError(err instanceof Error ? err.message : 'Could not load your balance.')),
      getHistory(address)
        .then((h) => (setHistory(h), setHistoryError(null)))
        .catch((err) => setHistoryError(err instanceof Error ? err.message : 'Could not load your history.')),
      listFriends().then(setFriends),
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
        {balance ? <Text style={styles.rate}>Today: US$1 = R{balance.zarPerUsdc.toFixed(2)}</Text> : null}
        {balanceError ? <Text style={styles.error}>{balanceError}</Text> : null}
      </View>

      <View style={styles.actions}>
        <BigButton label="Pay" onPress={() => router.push('/pay')} style={styles.action} />
        <BigButton label="Receive" variant="secondary" onPress={() => router.push('/receive')} style={styles.action} />
      </View>

      <Text style={styles.sectionTitle}>Recent activity</Text>
      {historyError ? <Text style={styles.error}>{historyError}</Text> : null}
      {history && history.length === 0 ? <Text style={styles.empty}>No payments yet. Top up at the shop to get started.</Text> : null}
      {!history && !historyError ? <Text style={styles.empty}>Loading…</Text> : null}
    </View>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={history ?? []}
        keyExtractor={(item, i) => `${item.txHash}-${i}`}
        ListHeaderComponent={header}
        renderItem={({ item }) => <HistoryRow item={item} friends={friends} hidden={hidden} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Friends"
        style={({ pressed }) => [styles.fab, { bottom: 24 + insets.bottom }, pressed && styles.fabPressed]}>
        <PersonIcon size={32} />
      </Pressable>

      <FriendsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onChoose={(mode) => {
          setSheetOpen(false);
          router.push({ pathname: '/friends', params: { mode } });
        }}
      />
    </View>
  );
}

function HistoryRow({ item, friends, hidden }: { item: HistoryItem; friends: Friend[]; hidden: boolean }) {
  const friend = findFriend(friends, item.counterparty);
  const name = item.label ?? friend?.name ?? (item.direction === 'in' ? 'Money received' : 'Money sent');
  const detail = item.label || friend ? formatWhen(item.timestamp) : `${formatWhen(item.timestamp)} · ${shortCode(item.counterparty)}`;
  const incoming = item.direction === 'in';
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, incoming ? styles.inIcon : styles.outIcon]}>
        <ArrowIcon direction={item.direction} color={incoming ? colors.success : colors.fg} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {incoming ? name : item.label ? `Paid ${name}` : friend ? `Sent to ${name}` : name}
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
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 18, color: colors.muted, fontWeight: '600' },
  amount: { fontSize: 52, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 17, color: colors.muted },
  rate: { fontSize: 15, color: colors.muted, marginTop: 8 },
  error: { fontSize: 16, color: colors.danger },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, minHeight: 64 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: colors.fg, marginTop: 8 },
  empty: { fontSize: 17, color: colors.muted },
  separator: { height: 1, backgroundColor: '#EEEEEE', marginLeft: 76 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inIcon: { backgroundColor: '#E3F6EC' },
  outIcon: { backgroundColor: colors.card },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '700', color: colors.fg },
  rowDetail: { fontSize: 14, color: colors.muted },
  rowAmount: { fontSize: 17, fontWeight: '800', color: colors.fg, fontVariant: ['tabular-nums'] },
  fab: {
    position: 'absolute',
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPressed: { opacity: 0.8 },
});
