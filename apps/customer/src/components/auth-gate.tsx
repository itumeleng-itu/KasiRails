import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { USERNAME_PATTERN, normalizeUsername } from '@kasi-rails/shared';

import { PinPad } from '@/components/pin-pad';
import { BigButton, colors } from '@/components/ui';
import {
  activate,
  activeAccount,
  deactivate,
  getLastAccountId,
  listAccounts,
  migrateLegacyWallet,
  removeAccount,
  type AccountInfo,
} from '@/lib/accounts';
import {
  authenticateBiometric,
  checkUsername,
  getBiometricInfo,
  getPinLength,
  hasPin,
  isBiometricsEnabled,
  pinLockoutRemaining,
  resetPinAttempts,
  resumeSignup,
  setBiometricsEnabled,
  setPin,
  signUp,
  verifyPin,
  type BiometricInfo,
} from '@/lib/auth';
import { shortCode } from '@/lib/format';

/** Lock again if the app was in the background for longer than this (e.g. not when copying an address from another app). */
const RELOCK_AFTER_MS = 2 * 60_000;

// Development only: Expo reloads the app on every code change, which would otherwise always
// land on the login screen. A short session survives those reloads. Never used in release builds.
const DEV_SESSION_KEY = 'kasi-rails.dev-session';
const DEV_SESSION_MS = 10 * 60_000;

async function saveDevSession(id: string) {
  if (__DEV__) await SecureStore.setItemAsync(DEV_SESSION_KEY, JSON.stringify({ id, until: Date.now() + DEV_SESSION_MS })).catch(() => {});
}

async function readDevSession(): Promise<string | null> {
  if (!__DEV__) return null;
  try {
    const raw = await SecureStore.getItemAsync(DEV_SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as { id: string; until: number }) : null;
    return session && session.until > Date.now() ? session.id : null;
  } catch {
    return null;
  }
}

function clearDevSession() {
  if (__DEV__) SecureStore.deleteItemAsync(DEV_SESSION_KEY).catch(() => {});
}
const MIN_PIN = 4;
const MAX_PIN = 6;

type Screen =
  | { kind: 'loading' }
  | { kind: 'pick'; accounts: AccountInfo[] }
  | { kind: 'signup'; canCancel: boolean }
  | { kind: 'set-pin'; account: AccountInfo }
  | { kind: 'unlock'; account: AccountInfo; canSwitch: boolean }
  | { kind: 'ready' };

interface AuthValue {
  account: AccountInfo | null;
  username: string | null;
  /** Locks this account and shows the account picker. */
  logout: () => void;
  /** Deletes the logged-in account and its wallet from this phone. */
  removeCurrentAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({ account: null, username: null, logout: () => {}, removeCurrentAccount: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Covers the app until someone logs in: pick an account (or create one), then unlock it
 * with Face ID / fingerprint or its PIN. The app below is re-created for each account.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  /** Where to go when nobody is logged in. */
  const showStart = useCallback(async () => {
    const accounts = await listAccounts();
    if (accounts.length === 0) return setScreen({ kind: 'signup', canCancel: false });
    const lastId = await getLastAccountId();
    const last = accounts.find((a) => a.id === lastId);
    if (last) return setScreen({ kind: 'unlock', account: last, canSwitch: true });
    setScreen(accounts.length === 1 ? { kind: 'unlock', account: accounts[0], canSwitch: true } : { kind: 'pick', accounts });
  }, []);

  const enter = useCallback(async (info: AccountInfo) => {
    await activate(info);
    setAccount(info);
    setScreen({ kind: 'ready' });
    saveDevSession(info.id);
  }, []);

  useEffect(() => {
    (async () => {
      await migrateLegacyWallet().catch(() => {});
      const resumed = await resumeSignup();
      if (resumed) return setScreen({ kind: 'set-pin', account: resumed });
      const sessionId = await readDevSession();
      const sessionAccount = sessionId ? (await listAccounts()).find((a) => a.id === sessionId) : undefined;
      if (sessionAccount) return enter(sessionAccount);
      await showStart();
    })().catch(() => setScreen({ kind: 'signup', canCancel: false }));
  }, [showStart, enter]);

  // Lock (not log out) when the app comes back after a while in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        const current = activeAccount();
        if (away > RELOCK_AFTER_MS && current) {
          clearDevSession();
          setScreen((s) => (s.kind === 'ready' ? { kind: 'unlock', account: current, canSwitch: true } : s));
        }
      }
    });
    return () => sub.remove();
  }, []);

  const logout = useCallback(() => {
    clearDevSession();
    deactivate();
    setAccount(null);
    listAccounts().then((accounts) => setScreen({ kind: 'pick', accounts }));
  }, []);

  const removeCurrentAccount = useCallback(async () => {
    const current = activeAccount();
    if (!current) return;
    clearDevSession();
    await removeAccount(current.id);
    setAccount(null);
    await showStart();
  }, [showStart]);

  const value: AuthValue = { account, username: account?.username ?? null, logout, removeCurrentAccount };

  return (
    <AuthContext.Provider value={value}>
      <View style={styles.flex}>
        {/* Re-created per account so no screen or data carries over between accounts. */}
        <Fragment key={account?.id ?? 'none'}>{children}</Fragment>
        {screen.kind !== 'ready' ? (
          <View style={styles.cover}>
            {screen.kind === 'loading' ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.fg} />
              </View>
            ) : null}
            {screen.kind === 'pick' ? (
              <Pick
                accounts={screen.accounts}
                onPick={(a) => setScreen({ kind: 'unlock', account: a, canSwitch: true })}
                onAdd={() => setScreen({ kind: 'signup', canCancel: true })}
              />
            ) : null}
            {screen.kind === 'signup' ? (
              <SignUp
                onDone={(a) => setScreen({ kind: 'set-pin', account: a })}
                onCancel={screen.canCancel ? () => listAccounts().then((accounts) => setScreen({ kind: 'pick', accounts })) : undefined}
              />
            ) : null}
            {screen.kind === 'set-pin' ? <SetPin account={screen.account} onDone={() => enter(screen.account)} /> : null}
            {screen.kind === 'unlock' ? (
              <Unlock
                key={screen.account.id}
                account={screen.account}
                onDone={() => {
                  if (activeAccount()?.id !== screen.account.id) return enter(screen.account);
                  setScreen({ kind: 'ready' });
                  saveDevSession(screen.account.id);
                }}
                onSwitch={screen.canSwitch ? () => listAccounts().then((accounts) => setScreen({ kind: 'pick', accounts })) : undefined}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </AuthContext.Provider>
  );
}

// ---- Who's using the app?

function Pick({ accounts, onPick, onAdd }: { accounts: AccountInfo[]; onPick: (a: AccountInfo) => void; onAdd: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.brand}>Kasi Rails</Text>
      <Text style={styles.title}>Who's using Kasi Rails?</Text>
      {accounts.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => onPick(a)}
          accessibilityRole="button"
          accessibilityLabel={`Log in as ${a.username}`}
          style={({ pressed }) => [styles.accountRow, pressed && styles.pressed]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{a.username.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.accountName}>@{a.username}</Text>
            <Text style={styles.accountCode}>{shortCode(a.address)}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
      <View style={styles.spacer} />
      <BigButton label="Add another account" variant="secondary" onPress={onAdd} />
    </ScrollView>
  );
}

// ---- Create an account: new wallet + unique username

function SignUp({ onDone, onCancel }: { onDone: (a: AccountInfo) => void; onCancel?: () => void }) {
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
      onDone(await signUp(name));
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
        <Text style={styles.body}>Choose a username. Shops and friends will see it. Each account has its own money.</Text>
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
        {onCancel ? <BigButton label="Back" variant="secondary" onPress={onCancel} /> : null}
        <Text style={styles.note}>Your money stays on this phone. Test network only: there is no backup yet, so don't delete the app.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---- Choose a PIN, then optionally turn on Face ID / fingerprint

function SetPin({ account, onDone }: { account: AccountInfo; onDone: () => void }) {
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
    await setPin(account.id, pin);
    if (bio?.available) setStep('biometrics');
    else onDone();
  };

  const enableBiometrics = async () => {
    if (await authenticateBiometric(`Turn on ${bio?.label ?? 'fingerprint'}`)) await setBiometricsEnabled(account.id, true);
    onDone();
  };

  const pad = { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 };
  if (step === 'biometrics' && bio) {
    return (
      <View style={[styles.page, styles.flex, pad]}>
        <Text style={styles.title}>Unlock with {bio.label}?</Text>
        <Text style={styles.body}>You can always use your PIN instead.</Text>
        <View style={styles.spacer} />
        <BigButton label={`Use ${bio.label}`} onPress={enableBiometrics} />
        <BigButton label="Not now" variant="secondary" onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={[styles.page, styles.flex, pad]}>
      <Text style={styles.brand}>@{account.username}</Text>
      <Text style={styles.title}>{step === 'enter' ? 'Choose a PIN' : 'Enter it again'}</Text>
      <Text style={styles.body}>{step === 'enter' ? `${MIN_PIN} to ${MAX_PIN} numbers. You'll use it to log in.` : 'To make sure it’s right.'}</Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <View style={styles.spacer} />
      <PinPad value={pin} maxLength={step === 'confirm' ? first.length : MAX_PIN} onChange={setPinValue} />
      <BigButton label="Next" onPress={next} disabled={step === 'confirm' ? pin.length !== first.length : pin.length < MIN_PIN} />
    </View>
  );
}

// ---- Log in: Face ID / fingerprint first, PIN as fallback

function Unlock({ account, onDone, onSwitch }: { account: AccountInfo; onDone: () => void; onSwitch?: () => void }) {
  const insets = useSafeAreaInsets();
  const [pin, setPinValue] = useState('');
  const [length, setLength] = useState(4);
  const [message, setMessage] = useState<string | null>(null);
  const [lockedMs, setLockedMs] = useState(0);
  const [bio, setBio] = useState<BiometricInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);

  const tryBiometric = useCallback(async () => {
    if (await authenticateBiometric(`Log in as @${account.username}`)) {
      await resetPinAttempts(account.id);
      onDone();
    }
  }, [account, onDone]);

  useEffect(() => {
    (async () => {
      // An account whose PIN was never set (e.g. sign-up interrupted) sets one now.
      if (!(await hasPin(account.id))) return setNeedsPin(true);
      setLength(await getPinLength(account.id));
      setLockedMs(await pinLockoutRemaining(account.id));
      const [info, enabled] = await Promise.all([getBiometricInfo(), isBiometricsEnabled(account.id)]);
      if (info.available && enabled) {
        setBio(info);
        tryBiometric();
      }
    })();
  }, [account, tryBiometric]);

  // Count down a lockout.
  useEffect(() => {
    if (lockedMs <= 0) return;
    const t = setInterval(() => setLockedMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(t);
  }, [lockedMs]);

  if (needsPin) return <SetPin account={account} onDone={onDone} />;

  const onChange = async (value: string) => {
    setPinValue(value);
    setMessage(null);
    if (value.length < length) return;
    setChecking(true);
    const result = await verifyPin(account.id, value);
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
      <Text style={styles.title}>Welcome back, @{account.username}</Text>
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
      {onSwitch ? (
        <Pressable onPress={onSwitch} accessibilityRole="button" style={styles.link}>
          <Text style={styles.linkText}>Not @{account.username}? Switch account</Text>
        </Pressable>
      ) : null}
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
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '800', color: colors.fg },
  accountName: { fontSize: 20, fontWeight: '700', color: colors.fg },
  accountCode: { fontSize: 14, color: colors.muted },
  chevron: { fontSize: 32, color: colors.muted },
  link: { alignSelf: 'center', paddingVertical: 10 },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.primary },
});
