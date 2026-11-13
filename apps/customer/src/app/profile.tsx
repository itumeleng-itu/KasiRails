import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/components/auth-gate';
import { BigButton, colors } from '@/components/ui';
import { authenticateBiometric, getBiometricInfo, isBiometricsEnabled, setBiometricsEnabled, type BiometricInfo } from '@/lib/auth';
import { readUsdcBalance } from '@/lib/chain';
import { formatDollars, shortCode } from '@/lib/format';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { account, logout, removeCurrentAccount } = useAuth();
  const [bio, setBio] = useState<BiometricInfo | null>(null);
  const [bioOn, setBioOn] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!account) return;
    getBiometricInfo().then(setBio);
    isBiometricsEnabled(account.id).then(setBioOn);
  }, [account]);

  // Hide the "Copied" note again after a moment.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!account) return null;

  const copyAddress = async () => {
    await Clipboard.setStringAsync(account.address);
    setCopied(true);
  };

  const toggleBiometrics = async (on: boolean) => {
    if (on && !(await authenticateBiometric(`Turn on ${bio?.label ?? 'fingerprint'}`))) return;
    await setBiometricsEnabled(account.id, on);
    setBioOn(on);
  };

  const confirmLogout = () => {
    Alert.alert('Log out?', `You'll need @${account.username}'s PIN${bioOn && bio ? ` or ${bio.label}` : ''} to log back in.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', onPress: logout },
    ]);
  };

  const confirmRemove = async () => {
    setRemoving(true);
    try {
      // There's no backup yet, so removing an account with money in it would lose the money.
      const balance = await readUsdcBalance(account.address);
      if (balance > 0n) {
        Alert.alert(
          'Move your money first',
          `@${account.username} still has ${formatDollars(balance)}. Removing it from this phone would lose that money, because there is no backup yet. Spend or send it first.`,
        );
        return;
      }
      Alert.alert(
        `Remove @${account.username}?`,
        "This deletes the account's wallet from this phone. It can't be opened again here.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => removeCurrentAccount() },
        ],
      );
    } catch {
      Alert.alert("Couldn't check the balance", 'Check your internet and try again.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{account.username.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>@{account.username}</Text>
        <Pressable onPress={copyAddress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Copy your code" style={({ pressed }) => [styles.codeButton, pressed && styles.pressed]}>
          <Text style={styles.code}>{shortCode(account.address)}</Text>
          <Text style={[styles.copyHint, copied && { color: colors.success }]}>{copied ? 'Copied ✓' : 'Tap to copy'}</Text>
        </Pressable>
      </View>

      {bio?.available || bio?.unavailableReason ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Log in with {bio.label}</Text>
            <Text style={styles.rowBody}>{bio.unavailableReason ?? 'Your PIN always works too.'}</Text>
          </View>
          <Switch value={bio.available && bioOn} onValueChange={toggleBiometrics} disabled={!bio.available} trackColor={{ true: colors.primary }} />
        </View>
      ) : null}

      <View style={styles.spacer} />
      <BigButton label="Log out" onPress={confirmLogout} />
      <BigButton label="Remove from this phone" variant="secondary" onPress={confirmRemove} busy={removing} />
      <Text style={styles.note}>Log out to switch to another account or add a new one. Each account has its own wallet and PIN.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flexGrow: 1, padding: 20, gap: 14 },
  header: { alignItems: 'center', gap: 6, marginVertical: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 36, fontWeight: '900', color: colors.fg },
  name: { fontSize: 26, fontWeight: '900', color: colors.fg },
  codeButton: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.card },
  pressed: { opacity: 0.6 },
  code: { fontSize: 16, fontWeight: '700', color: colors.fg },
  copyHint: { fontSize: 13, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.card },
  rowTitle: { fontSize: 18, fontWeight: '700', color: colors.fg },
  rowBody: { fontSize: 14, color: colors.muted },
  spacer: { flex: 1, minHeight: 24 },
  note: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
