import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';

import { BigButton, Message, colors } from '@/components/ui';
import { parseScan } from '@/lib/api';
import { shortCode } from '@/lib/format';
import { addFriend } from '@/lib/friends';
import { getAddress } from '@/lib/wallet';

export default function AddFriend() {
  const params = useLocalSearchParams<{ address?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [address, setAddress] = useState<string | null>(params.address ?? null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const handling = useRef(false);

  const accept = async (candidate: string) => {
    const scan = parseScan(candidate);
    if (scan?.kind !== 'address') {
      setError("That isn't a Kasi Rails Receive code. Ask your friend to open Receive and show you their code.");
      return false;
    }
    if (scan.address.toLowerCase() === (await getAddress()).toLowerCase()) {
      setError("That's your own code.");
      return false;
    }
    setError(null);
    setAddress(scan.address);
    return true;
  };

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handling.current) return;
    handling.current = true;
    if (!(await accept(data))) setTimeout(() => (handling.current = false), 1500);
  };

  const save = async () => {
    if (!address) return;
    setSaving(true);
    try {
      await addFriend(name, address);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  };

  // ---- Step 2: name them
  if (address) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <Text style={styles.title}>What's their name?</Text>
          <Text style={styles.muted}>Code {shortCode(address)}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Thabo"
            autoFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={save}
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <BigButton label="Save friend" onPress={save} busy={saving} disabled={!name.trim()} />
          <BigButton label="Scan a different code" variant="secondary" onPress={() => (handling.current = false, setAddress(null), setName(''))} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- Step 1 (fallback): type the code
  if (typing) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <Text style={styles.title}>Type their code</Text>
          <Text style={styles.muted}>It starts with 0x and is shown under their Receive code.</Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="0x…"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <BigButton label="Next" onPress={() => accept(typed)} disabled={!typed.trim()} />
          <BigButton label="Scan instead" variant="secondary" onPress={() => (setTyping(false), setError(null))} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- Step 1: scan
  if (!permission) return <View style={[styles.flex, styles.centered]}><ActivityIndicator size="large" color={colors.fg} /></View>;
  if (!permission.granted) {
    return (
      <View style={[styles.flex, styles.centered]}>
        <Message title="Allow the camera" body="Scan your friend's Receive code to add them." />
        {permission.canAskAgain ? (
          <BigButton label="Allow camera" onPress={requestPermission} style={styles.wide} />
        ) : (
          <BigButton label="Open settings" onPress={() => Linking.openSettings()} style={styles.wide} />
        )}
        <BigButton label="Type their code" variant="secondary" onPress={() => setTyping(true)} style={styles.wide} />
      </View>
    );
  }
  return (
    <View style={styles.flex}>
      <CameraView style={styles.flex} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>{error ?? "Scan your friend's Receive code"}</Text>
        <BigButton label="Type their code" variant="secondary" onPress={() => setTyping(true)} style={styles.overlayButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  wide: { alignSelf: 'stretch' },
  form: { flex: 1, padding: 24, gap: 14 },
  title: { fontSize: 26, fontWeight: '800', color: colors.fg },
  muted: { fontSize: 17, color: colors.muted },
  input: {
    fontSize: 22,
    borderWidth: 2,
    borderColor: colors.fg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.fg,
  },
  error: { fontSize: 17, color: colors.danger },
  overlay: { position: 'absolute', left: 20, right: 20, bottom: 40, gap: 12, alignItems: 'center' },
  overlayText: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    overflow: 'hidden',
    textAlign: 'center',
  },
  overlayButton: { alignSelf: 'stretch', backgroundColor: '#FFFFFF' },
});
