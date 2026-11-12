import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BigButton, colors } from '@/components/ui';
import { shortCode } from '@/lib/format';
import { listFriends, removeFriend, type Friend } from '@/lib/friends';

export default function Friends() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === 'request' ? 'request' : 'pay';
  const [friends, setFriends] = useState<Friend[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      listFriends().then(setFriends);
    }, []),
  );

  const confirmRemove = (friend: Friend) => {
    Alert.alert(`Remove ${friend.name}?`, 'You can add them again by scanning their code.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeFriend(friend.address).then(() => listFriends().then(setFriends)) },
    ]);
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: mode === 'pay' ? 'Pay a friend' : 'Request from a friend' }} />
      <FlatList
        data={friends ?? []}
        keyExtractor={(f) => f.address}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.hint}>{mode === 'pay' ? 'Who are you paying?' : 'Who should pay you?'}</Text>}
        ListEmptyComponent={
          friends ? <Text style={styles.empty}>No friends yet. Add one by scanning the code on their Receive screen.</Text> : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/amount', params: { mode, address: item.address, name: item.name } })}
            onLongPress={() => confirmRemove(item)}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.code}>{shortCode(item.address)}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <BigButton label="Add a friend" variant="secondary" onPress={() => router.push('/add-friend')} />
        {friends && friends.length > 0 ? <Text style={styles.tip}>Press and hold a friend to remove them.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 20, gap: 10, flexGrow: 1 },
  hint: { fontSize: 20, fontWeight: '700', color: colors.fg, marginBottom: 6 },
  empty: { fontSize: 18, color: colors.muted, lineHeight: 26 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '800', color: colors.fg },
  rowMain: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '700', color: colors.fg },
  code: { fontSize: 14, color: colors.muted },
  chevron: { fontSize: 32, color: colors.muted },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  tip: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
