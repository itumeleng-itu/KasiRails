import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Hex } from 'viem';
import { USERNAME_PATTERN, normalizeUsername, usdcToZarCents, zarCentsToUsdc } from '@kasi-rails/shared';

import { useAuth } from '@/components/auth-gate';
import { Keypad, entryToCents, pressKey } from '@/components/keypad';
import { Success } from '@/components/success';
import { BigButton, Message, colors } from '@/components/ui';
import { API_URL, ApiError, getRate, getUsdcDomain, lookupUser, sendTransfer } from '@/lib/api';
import { readUsdcBalance } from '@/lib/chain';
import { formatRand } from '@/lib/format';
import { getAddress, signTransfer } from '@/lib/wallet';

const MAX_CENTS = 10_000_00; // R10,000, matches the server's per-payment cap at typical rates

interface Recipient {
  username: string;
  address: Hex;
}

type Step =
  | { kind: 'who' }
  | { kind: 'amount'; to: Recipient }
  | { kind: 'confirm'; to: Recipient; zarCents: number; usdcAmount: bigint; sending: boolean }
  | { kind: 'sent'; to: Recipient; zarCents: number; confirmed: boolean }
  | { kind: 'error'; title: string; body: string };

export default function Send() {
  const [step, setStep] = useState<Step>({ kind: 'who' });

  if (step.kind === 'who') return <Who onNext={(to) => setStep({ kind: 'amount', to })} />;
  if (step.kind === 'amount') return <Amount to={step.to} onNext={(zarCents, usdcAmount) => setStep({ kind: 'confirm', to: step.to, zarCents, usdcAmount, sending: false })} />;
  if (step.kind === 'confirm') return <Confirm step={step} setStep={setStep} />;
  if (step.kind === 'sent') {
    return (
      <Success
        zarCents={step.zarCents}
        message={step.confirmed ? `Sent to @${step.to.username}` : `Sent to @${step.to.username}. It will arrive in a moment.`}
        onDone={() => router.back()}
      />
    );
  }
  return (
    <Centered>
      <Message title={step.title} body={step.body} tone="danger" />
      <View style={styles.buttons}>
        <BigButton label="Try again" onPress={() => setStep({ kind: 'who' })} />
        <BigButton label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Centered>
  );
}

// ---- Who are you sending to?

function Who({ onNext }: { onNext: (to: Recipient) => void }) {
  const { username: me } = useAuth();
  const [input, setInput] = useState('');
  const [found, setFound] = useState<Recipient | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const name = normalizeUsername(input);
  const valid = USERNAME_PATTERN.test(name);

  // Look the username up shortly after the user stops typing.
  useEffect(() => {
    setFound(null);
    setStatus(null);
    if (!valid) return;
    if (name === me) {
      setStatus({ text: "That's you. Choose someone else.", ok: false });
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      lookupUser(name)
        .then((user) => {
          if (cancelled) return;
          if (user) {
            setFound(user);
            setStatus({ text: `✓ @${user.username}`, ok: true });
          } else {
            setStatus({ text: `No one has the username @${name}`, ok: false });
          }
        })
        .catch(() => !cancelled && setStatus({ text: "Couldn't check. Check your internet.", ok: false }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, valid, me]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.page}>
        <Text style={styles.title}>Who are you sending to?</Text>
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
            returnKeyType="next"
            onSubmitEditing={() => found && onNext(found)}
            style={styles.input}
          />
        </View>
        <Text style={[styles.hint, status && { color: status.ok ? colors.success : colors.danger }]}>{status?.text ?? ' '}</Text>
        <View style={styles.spacer} />
        <BigButton label="Next" onPress={() => found && onNext(found)} disabled={!found} />
      </View>
    </KeyboardAvoidingView>
  );
}

// ---- How much?

function Amount({ to, onNext }: { to: Recipient; onNext: (zarCents: number, usdcAmount: bigint) => void }) {
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRate()
      .then((r) => setRate(r.zarPerUsdc))
      .catch(() => setError("Couldn't get today's rate. Check your internet."));
    getAddress()
      .then(readUsdcBalance)
      .then(setBalance)
      .catch(() => {});
  }, []);

  const cents = entryToCents(entry);
  const usdcAmount = rate && cents > 0 ? zarCentsToUsdc(cents, rate) : 0n;
  const balanceCents = rate && balance !== null ? usdcToZarCents(balance, rate) : null;
  const tooMuch = balance !== null && usdcAmount > balance;
  const problem = error ?? (cents > MAX_CENTS ? `Maximum is ${formatRand(MAX_CENTS)}` : tooMuch ? 'Not enough money' : null);

  return (
    <View style={[styles.page, { paddingBottom: 16 + insets.bottom }]}>
      <Text style={styles.prompt}>How much are you sending to @{to.username}?</Text>
      <Text style={styles.entry} adjustsFontSizeToFit numberOfLines={1}>
        R{entry || '0'}
      </Text>
      <Text style={[styles.mutedCenter, problem && { color: colors.danger }]}>
        {problem ?? (balanceCents !== null ? `You have ${formatRand(balanceCents)}` : ' ')}
      </Text>
      <View style={styles.spacer} />
      <Keypad onKey={(k) => setEntry((e) => pressKey(e, k))} />
      <BigButton label="Continue" onPress={() => onNext(cents, usdcAmount)} disabled={cents <= 0 || usdcAmount === 0n || !!problem} />
    </View>
  );
}

// ---- Confirm and send

function Confirm({ step, setStep }: { step: Extract<Step, { kind: 'confirm' }>; setStep: (s: Step) => void }) {
  const send = async () => {
    setStep({ ...step, sending: true });
    try {
      const domain = await getUsdcDomain(API_URL);
      const auth = await signTransfer({ to: step.to.address, value: step.usdcAmount, domain });
      const { confirmed } = await sendTransfer(auth);
      setStep({ kind: 'sent', to: step.to, zarCents: step.zarCents, confirmed });
    } catch (err) {
      const insufficient = err instanceof ApiError && err.code === 'INSUFFICIENT_FUNDS';
      setStep({
        kind: 'error',
        title: insufficient ? 'Not enough money' : "Payment didn't go through",
        body: insufficient ? 'Top up at the shop, then try again.' : err instanceof Error ? err.message : 'Please try again.',
      });
    }
  };

  return (
    <Centered>
      <Text style={styles.question}>Send</Text>
      <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>
        {formatRand(step.zarCents)}
      </Text>
      <Text style={styles.question}>to @{step.to.username}?</Text>
      <View style={styles.buttons}>
        <BigButton label={step.sending ? 'Sending…' : 'Send'} onPress={send} busy={step.sending} />
        {!step.sending ? <BigButton label="Change amount" variant="secondary" onPress={() => setStep({ kind: 'amount', to: step.to })} /> : null}
      </View>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={[styles.flex, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, padding: 20, gap: 12 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  buttons: { alignSelf: 'stretch', gap: 12, marginTop: 16 },
  spacer: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', color: colors.fg },
  prompt: { fontSize: 19, fontWeight: '700', color: colors.fg },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.fg, borderRadius: 14, paddingHorizontal: 14 },
  at: { fontSize: 22, fontWeight: '800', color: colors.muted },
  input: { flex: 1, fontSize: 22, paddingVertical: 12, paddingHorizontal: 6, color: colors.fg },
  hint: { fontSize: 16, color: colors.muted, minHeight: 22 },
  entry: { fontSize: 56, fontWeight: '900', color: colors.fg, textAlign: 'center', fontVariant: ['tabular-nums'] },
  mutedCenter: { fontSize: 17, color: colors.muted, textAlign: 'center' },
  question: { fontSize: 24, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  amount: { fontSize: 56, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
});
