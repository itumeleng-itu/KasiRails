import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { USERNAME_PATTERN, normalizeUsername } from '@kasi-rails/shared';

import { PinPad } from '@/components/pin-pad';
import { BigButton, colors } from '@/components/ui';
import {
  authenticateBiometric,
  checkUsername,
  getBiometricInfo,
  getLocalUsername,
  getPinLength,
  hasPin,
  isBiometricsEnabled,
  pinLockoutRemaining,
  registerUsername,
  resetPinAttempts,
  restoreUsername,
  setBiometricsEnabled,
  setPin,
  verifyPin,
  type BiometricInfo,
} from '@/lib/auth';

/** Lock again if the app was in the background for longer than this. */
const RELOCK_AFTER_MS = 15_000;
const MIN_PIN = 4;
const MAX_PIN = 6;

type Gate = 'loading' | 'register' | 'set-pin' | 'locked' | 'unlocked';

const AuthContext = createContext<{ username: string | null }>({ username: null });

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Covers the app until the user has registered a username, set a PIN, and unlocked
 * with Face ID / fingerprint or the PIN. The app underneath stays mounted.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const name = (await getLocalUsername()) ?? (await restoreUsername());
      setUsername(name);
      if (!name) return setGate('register');
      setGate((await hasPin()) ? 'locked' : 'set-pin');
    })().catch(() => setGate('register'));
  }, []);

  // Lock when the app comes back after a while in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS) setGate((g) => (g === 'unlocked' ? 'locked' : g));
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <AuthContext.Provider value={{ username }}>
      <View style={styles.flex}>
        {children}
        {gate !== 'unlocked' ? (
          <View style={styles.cover}>
            {gate === 'loading' ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.fg} />
              </View>
            ) : null}
            {gate === 'register' ? (
              <Register
                onDone={(name) => {
                  setUsername(name);
                  setGate('set-pin');
                }}
              />
            ) : null}
            {gate === 'set-pin' ? <SetPin onDone={() => setGate('unlocked')} /> : null}
            {gate === 'locked' ? <Unlock username={username} onDone={() => setGate('unlocked')} /> : null}
          </View>
        ) : null}
      </View>
    </AuthContext.Provider>
  );
}

// ---- Create account: choose a unique username

function Register({ onDone }: { onDone: (username: string) => void }) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = normalizeUsername(input);
  const valid = USERNAME_PATTERN.test(name);

  // Check availability shortly after the user stops typing.
  useEffect(() => {
    setStatus(null);
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      checkUsername(name)
        .then((r) => !cancelled && setStatus(r.available ? { text: `@${r.username} is available`, ok: true } : { text: r.reason ?? `@${r.username} is taken`, ok: false }))
        .catch(() => !cancelled && setStatus(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, valid]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await registerUsername(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>Kasi Rails</Text>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.body}>Choose a username. Shops and friends will see it.</Text>
        <View style={styles.inputRow}>
          <Text style={styles.at}>@</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={21}
            returnKeyType="done"
            onSubmitEditing={() => valid && status?.ok && submit()}
            style={styles.input}
          />
        </View>
        <Text style={[styles.hint, status && { color: status.ok ? colors.success : colors.danger }]}>
          {status?.text ?? (input && !valid ? '3 to 20 letters, numbers or _' : ' ')}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <BigButton label="Create account" onPress={submit} busy={busy} disabled={!valid || status?.ok === false} />
        <Text style={styles.note}>Your money stays on this phone. Test network only: there is no backup yet, so don't delete the app.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---- Choose a PIN, then optionally turn on Face ID / fingerprint

function SetPin({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'enter' | 'confirm' | 'biometrics'>('enter');
  const [first, setFirst] = useState('');
  const [pin, setPinValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [bio, setBio] = useState<BiometricInfo | null>(null);

  useEffect(() => {
    getBiometricInfo().then(setBio);
  }, []);

  const next = async () => {
    if (step === 'enter') {
      setFirst(pin);
      setPinValue('');
      setMessage(null);
      setStep('confirm');
      return;
    }
    if (pin !== first) {
      setPinValue('');
      setFirst('');
      setStep('enter');
      setMessage("The PINs didn't match. Try again.");
      return;
    }
    await setPin(pin);
    if (bio?.available) setStep('biometrics');
    else onDone();
  };

  const enableBiometrics = async () => {
    if (await authenticateBiometric(`Turn on ${bio?.label ?? 'fingerprint'}`)) await setBiometricsEnabled(true);
    onDone();
  };

  if (step === 'biometrics' && bio) {
    return (
      <View style={[styles.page, styles.flex, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>Unlock with {bio.label}?</Text>
        <Text style={styles.body}>You can always use your PIN instead.</Text>
        <View style={styles.spacer} />
        <BigButton label={`Use ${bio.label}`} onPress={enableBiometrics} />
        <BigButton label="Not now" variant="secondary" onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={[styles.page, styles.flex, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.title}>{step === 'enter' ? 'Choose a PIN' : 'Enter it again'}</Text>
      <Text style={styles.body}>{step === 'enter' ? `${MIN_PIN} to ${MAX_PIN} numbers. You'll use it to open the app.` : 'To make sure it’s right.'}</Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <View style={styles.spacer} />
      <PinPad value={pin} maxLength={step === 'confirm' ? first.length : MAX_PIN} onChange={setPinValue} />
      <BigButton label="Next" onPress={next} disabled={step === 'confirm' ? pin.length !== first.length : pin.length < MIN_PIN} />
    </View>
  );
}

// ---- Unlock: Face ID / fingerprint first, PIN as fallback

function Unlock({ username, onDone }: { username: string | null; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [pin, setPinValue] = useState('');
  const [length, setLength] = useState(4);
  const [message, setMessage] = useState<string | null>(null);
  const [lockedMs, setLockedMs] = useState(0);
  const [bio, setBio] = useState<BiometricInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const tryBiometric = useCallback(async () => {
    if (await authenticateBiometric()) {
      await resetPinAttempts();
      onDone();
    }
  }, [onDone]);

  useEffect(() => {
    (async () => {
      setLength(await getPinLength());
      setLockedMs(await pinLockoutRemaining());
      const [info, enabled] = await Promise.all([getBiometricInfo(), isBiometricsEnabled()]);
      if (info.available && enabled) {
        setBio(info);
        tryBiometric();
      }
    })();
  }, [tryBiometric]);

  // Count down a lockout.
  useEffect(() => {
    if (lockedMs <= 0) return;
    const t = setInterval(() => setLockedMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(t);
  }, [lockedMs]);

  const onChange = async (value: string) => {
    setPinValue(value);
    setMessage(null);
    if (value.length < length) return;
    setChecking(true);
    const result = await verifyPin(value);
    setChecking(false);
    if (result.ok) return onDone();
    setPinValue('');
    if (result.lockedForMs > 0) setLockedMs(result.lockedForMs);
    else setMessage(`Wrong PIN. ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} left before a short wait.`);
  };

  const locked = lockedMs > 0;
  return (
    <View style={[styles.page, styles.flex, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.brand}>Kasi Rails</Text>
      <Text style={styles.title}>{username ? `Welcome back, @${username}` : 'Welcome back'}</Text>
      <Text style={[styles.body, (message || locked) && { color: colors.danger }]}>
        {locked ? `Too many wrong PINs. Try again in ${Math.ceil(lockedMs / 1000)} seconds.` : message ?? 'Enter your PIN'}
      </Text>
      <View style={styles.spacer} />
      <PinPad
        value={pin}
        maxLength={length}
        onChange={onChange}
        disabled={locked || checking}
        extra={bio ? { label: bio.label, onPress: tryBiometric } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { paddingHorizontal: 24, gap: 14, flexGrow: 1 },
  spacer: { flex: 1, minHeight: 12 },
  brand: { fontSize: 18, fontWeight: '800', color: colors.primary },
  title: { fontSize: 28, fontWeight: '900', color: colors.fg },
  body: { fontSize: 18, color: colors.muted, lineHeight: 25 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.fg, borderRadius: 14, paddingHorizontal: 14 },
  at: { fontSize: 24, fontWeight: '800', color: colors.muted },
  input: { flex: 1, fontSize: 24, paddingVertical: 14, paddingHorizontal: 6, color: colors.fg },
  hint: { fontSize: 16, color: colors.muted, minHeight: 22 },
  error: { fontSize: 17, color: colors.danger },
  note: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 8 },
});
