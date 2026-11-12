import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { getAddress as checksum, isAddress, type Hex } from 'viem';
import { zarCentsToUsdc } from '@kasi-rails/shared';

import { Keypad, entryToCents, pressKey } from '@/components/keypad';
import { Success } from '@/components/success';
import { BigButton, Message, colors } from '@/components/ui';
import { ApiError, getBalance, getRate, getUsdcDomain, requestQrData, sendTransfer, API_URL } from '@/lib/api';
import { formatRand } from '@/lib/format';
import { getAddress, signTransfer } from '@/lib/wallet';

const MAX_CENTS = 10_000_00; // R10,000

type Step =
  | { kind: 'enter' }
  | { kind: 'confirm'; zarCents: number; usdcAmount: bigint }
  | { kind: 'sending'; zarCents: number; usdcAmount: bigint }
  | { kind: 'sent'; zarCents: number; confirmed: boolean }
  | { kind: 'request'; zarCents: number; qr: string }
  | { kind: 'error'; title: string; body: string };

export default function Amount() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; address?: string; name?: string }>();
  const mode = params.mode === 'request' ? 'request' : 'pay';
  const name = params.name || 'your friend';
  const friendAddress = params.address && isAddress(params.address) ? (checksum(params.address) as Hex) : null;

  const [entry, setEntry] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [balance, setBalance] = useState<{ zarCents: number; usdcAmount: bigint } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'pay') return;
    getAddress()
      .then(getBalance)
      .then((b) => setBalance({ zarCents: b.zarCents, usdcAmount: BigInt(b.usdcAmount) }))
      .catch(() => {});
  }, [mode]);

  if (!friendAddress) {
    return <Centered><Message title="Friend not found" body="Go back and choose a friend again." tone="danger" /></Centered>;
  }

  const cents = entryToCents(entry);

  const onContinue = async () => {
    setBusy(true);
    try {
      const { zarPerUsdc } = await getRate();
      const usdcAmount = zarCentsToUsdc(cents, zarPerUsdc);
      if (usdcAmount === 0n) throw new Error('Amount is too small.');
      if (mode === 'request') {
        setStep({ kind: 'request', zarCents: cents, qr: requestQrData(await getAddress(), usdcAmount, cents) });
      } else {
        setStep({ kind: 'confirm', zarCents: cents, usdcAmount });
      }
    } catch (err) {
      setStep({ kind: 'error', title: 'Something went wrong', body: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const onSend = async () => {
    if (step.kind !== 'confirm') return;
    const { zarCents, usdcAmount } = step;
    setStep({ kind: 'sending', zarCents, usdcAmount });
    try {
      const domain = await getUsdcDomain(API_URL);
      const auth = await signTransfer({ to: friendAddress, value: usdcAmount, domain });
      const { confirmed } = await sendTransfer(auth);
      setStep({ kind: 'sent', zarCents, confirmed });
    } catch (err) {
      const insufficient = err instanceof ApiError && err.code === 'INSUFFICIENT_FUNDS';
      setStep({
        kind: 'error',
        title: insufficient ? 'Not enough money' : "Payment didn't go through",
        body: insufficient ? 'Top up at the shop, then try again.' : err instanceof Error ? err.message : 'Please try again.',
      });
    }
  };

  const title = mode === 'pay' ? `Pay ${name}` : `Request from ${name}`;

  if (step.kind === 'sent') {
    return (
      <Success
        zarCents={step.zarCents}
        message={step.confirmed ? `Sent to ${name}` : `Sent to ${name}. It will arrive in a moment.`}
        onDone={() => router.dismissAll()}
      />
    );
  }

  if (step.kind === 'request') {
    return (
      <Centered>
        <Stack.Screen options={{ title }} />
        <Text style={styles.question}>Show this to {name}</Text>
        <Text style={styles.amount}>{formatRand(step.zarCents)}</Text>
        <View style={styles.qr}>
          <QRCode value={step.qr} size={250} quietZone={12} />
        </View>
        <Text style={styles.muted}>{name} scans it with Pay in their Kasi Rails app.</Text>
        <BigButton label="Done" variant="secondary" onPress={() => router.dismissAll()} style={styles.wide} />
      </Centered>
    );
  }

  if (step.kind === 'confirm' || step.kind === 'sending') {
    const enough = !balance || balance.usdcAmount >= step.usdcAmount;
    return (
      <Centered>
        <Stack.Screen options={{ title }} />
        <Text style={styles.question}>Send</Text>
        <Text style={styles.amount}>{formatRand(step.zarCents)}</Text>
        <Text style={styles.question}>to {name}?</Text>
        {balance ? (
          <Text style={[styles.muted, !enough && { color: colors.danger }]}>
            {enough ? `You have ${formatRand(balance.zarCents)}` : `Not enough money. You have ${formatRand(balance.zarCents)}.`}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          <BigButton label={step.kind === 'sending' ? 'Sending…' : 'Send'} onPress={onSend} busy={step.kind === 'sending'} disabled={!enough} />
          {step.kind === 'confirm' ? <BigButton label="Change amount" variant="secondary" onPress={() => setStep({ kind: 'enter' })} /> : null}
        </View>
      </Centered>
    );
  }

  if (step.kind === 'error') {
    return (
      <Centered>
        <Stack.Screen options={{ title }} />
        <Message title={step.title} body={step.body} tone="danger" />
        <View style={styles.buttons}>
          <BigButton label="Try again" onPress={() => setStep({ kind: 'enter' })} />
          <BigButton label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Centered>
    );
  }

  return (
    <View style={[styles.flex, styles.enter, { paddingBottom: 16 + insets.bottom }]}>
      <Stack.Screen options={{ title }} />
      <Text style={styles.prompt}>{mode === 'pay' ? `How much are you sending to ${name}?` : `How much should ${name} pay you?`}</Text>
      <Text style={styles.entry} adjustsFontSizeToFit numberOfLines={1}>R{entry || '0'}</Text>
      {mode === 'pay' && balance ? <Text style={styles.mutedCenter}>You have {formatRand(balance.zarCents)}</Text> : null}
      {cents > MAX_CENTS ? <Text style={styles.errorCenter}>Maximum is {formatRand(MAX_CENTS)}</Text> : null}
      <View style={styles.spacer} />
      <Keypad onKey={(k) => setEntry((e) => pressKey(e, k))} />
      <BigButton label="Continue" onPress={onContinue} busy={busy} disabled={cents <= 0 || cents > MAX_CENTS} />
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={[styles.flex, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  enter: { padding: 20, gap: 14 },
  wide: { alignSelf: 'stretch' },
  buttons: { alignSelf: 'stretch', gap: 14, marginTop: 12 },
  prompt: { fontSize: 20, fontWeight: '700', color: colors.fg },
  entry: { fontSize: 64, fontWeight: '900', color: colors.fg, textAlign: 'center', fontVariant: ['tabular-nums'] },
  spacer: { flex: 1 },
  question: { fontSize: 26, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  amount: { fontSize: 56, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
  muted: { fontSize: 18, color: colors.muted, textAlign: 'center' },
  mutedCenter: { fontSize: 18, color: colors.muted, textAlign: 'center' },
  errorCenter: { fontSize: 17, color: colors.danger, textAlign: 'center' },
  qr: { padding: 8, backgroundColor: '#FFFFFF', borderRadius: 16 },
});
