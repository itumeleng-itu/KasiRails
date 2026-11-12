import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';

import { BigButton, Message, colors } from '@/components/ui';
import { ApiError, getBalance, getOrder, getUsdcDomain, parseTillQr, payOrder, type ShopOrder } from '@/lib/api';
import { formatRand } from '@/lib/format';
import { getAddress, signPayment } from '@/lib/wallet';

type Step =
  | { kind: 'scan' }
  | { kind: 'loading' }
  | { kind: 'confirm'; order: ShopOrder; api: string; balanceZarCents: number | null; enough: boolean }
  | { kind: 'paying'; order: ShopOrder; api: string }
  | { kind: 'done'; order: ShopOrder; confirmed: boolean }
  | { kind: 'error'; title: string; body: string };

const EXPIRED = { title: 'Too late', body: 'This payment request has expired. Ask the shop to charge again.' };

function errorFor(err: unknown): { title: string; body: string } {
  if (err instanceof ApiError) {
    if (err.code === 'EXPIRED') return EXPIRED;
    if (err.code === 'INSUFFICIENT_FUNDS') return { title: 'Not enough money', body: 'Top up at the shop, then try again.' };
    if (err.code === 'ALREADY_PAID') return { title: 'Already paid', body: 'This has already been paid. Nothing more was taken.' };
    if (err.code === 'NOT_FOUND') return { title: 'Payment not found', body: 'Ask the shop to charge again.' };
    return { title: "Payment didn't go through", body: err.message };
  }
  return { title: "Payment didn't go through", body: err instanceof Error ? err.message : 'Please try again.' };
}

function useSecondsLeft(expiresAt: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) : 0;
}

export default function Pay() {
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const handling = useRef(false); // onBarcodeScanned fires repeatedly; handle one code at a time

  const order = step.kind === 'confirm' || step.kind === 'paying' ? step.order : undefined;
  const secondsLeft = useSecondsLeft(order?.expiresAt);

  const rescan = () => {
    handling.current = false;
    setStep({ kind: 'scan' });
  };

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handling.current) return;
    handling.current = true;

    const qr = parseTillQr(data);
    if (!qr) {
      setStep({ kind: 'error', title: "That's not a shop payment code", body: "Scan the code on the shop's till." });
      return;
    }

    setStep({ kind: 'loading' });
    try {
      const [o, balance] = await Promise.all([
        getOrder(qr.api, qr.orderId),
        getAddress().then((a) => getBalance(a, qr.api)).catch(() => null),
      ]);
      if (o.status === 'PAID') return setStep({ kind: 'error', title: 'Already paid', body: 'This has already been paid.' });
      if (o.status !== 'PENDING' || Date.parse(o.expiresAt) <= Date.now()) return setStep({ kind: 'error', ...EXPIRED });
      const enough = balance ? BigInt(balance.usdcAmount) >= BigInt(o.usdcAmount) : true;
      setStep({ kind: 'confirm', order: o, api: qr.api, balanceZarCents: balance?.zarCents ?? null, enough });
    } catch (err) {
      setStep({ kind: 'error', ...errorFor(err) });
    }
  };

  const onPay = async () => {
    if (step.kind !== 'confirm') return;
    const { order: o, api } = step;
    setStep({ kind: 'paying', order: o, api });
    try {
      const domain = await getUsdcDomain(api);
      const auth = await signPayment({
        orderId: o.id,
        to: o.shopAddress,
        value: BigInt(o.usdcAmount),
        validBefore: BigInt(Math.floor(Date.parse(o.expiresAt) / 1000)),
        domain,
      });
      const result = await payOrder(api, o.id, auth);
      setStep({ kind: 'done', order: result.order, confirmed: result.confirmed });
    } catch (err) {
      setStep({ kind: 'error', ...errorFor(err) });
    }
  };

  // ---- Camera permission
  if (step.kind === 'scan') {
    if (!permission) return <Centered><ActivityIndicator size="large" color={colors.fg} /></Centered>;
    if (!permission.granted) {
      return (
        <Centered>
          <Message title="Allow the camera" body="Kasi Rails needs the camera to scan the shop's payment code." />
          {permission.canAskAgain ? (
            <BigButton label="Allow camera" onPress={requestPermission} style={styles.wide} />
          ) : (
            <BigButton label="Open settings" onPress={() => Linking.openSettings()} style={styles.wide} />
          )}
        </Centered>
      );
    }
    return (
      <View style={styles.flex}>
        <CameraView style={styles.flex} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
        <View style={styles.scanHint}>
          <Text style={styles.scanHintText}>Point at the code on the shop's till</Text>
        </View>
      </View>
    );
  }

  if (step.kind === 'loading') {
    return <Centered><ActivityIndicator size="large" color={colors.fg} /><Text style={styles.muted}>Checking…</Text></Centered>;
  }

  if (step.kind === 'confirm' || step.kind === 'paying') {
    const o = step.order;
    const paying = step.kind === 'paying';
    const late = secondsLeft <= 0;
    return (
      <Centered>
        <Text style={styles.question}>Pay</Text>
        <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>{formatRand(o.zarCents)}</Text>
        <Text style={styles.question}>to {o.shopName}?</Text>
        <Text style={[styles.muted, late && { color: colors.danger }]}>
          {late ? 'Time is up. Ask the shop to charge again.' : `${secondsLeft} seconds left`}
        </Text>
        {step.kind === 'confirm' && step.balanceZarCents !== null ? (
          <Text style={[styles.muted, !step.enough && { color: colors.danger }]}>
            {step.enough ? `You have ${formatRand(step.balanceZarCents)}` : `Not enough money. You have ${formatRand(step.balanceZarCents)}.`}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          <BigButton label={paying ? 'Paying…' : 'Pay'} onPress={onPay} busy={paying} disabled={late || (step.kind === 'confirm' && !step.enough)} />
          {!paying ? <BigButton label="Cancel" variant="secondary" onPress={() => router.back()} /> : null}
        </View>
      </Centered>
    );
  }

  if (step.kind === 'done') {
    return (
      <View style={[styles.flex, styles.success]}>
        <Text style={styles.tick}>✓</Text>
        <Text style={styles.successAmount} adjustsFontSizeToFit numberOfLines={1}>{formatRand(step.order.zarCents)}</Text>
        <Text style={styles.successText}>
          {step.confirmed ? `Paid to ${step.order.shopName}` : `Sent to ${step.order.shopName}. The shop will see it in a moment.`}
        </Text>
        <BigButton label="Done" variant="secondary" onPress={() => router.back()} style={styles.wide} />
      </View>
    );
  }

  return (
    <Centered>
      <Message title={step.title} body={step.body} tone="danger" />
      <View style={styles.buttons}>
        <BigButton label="Scan again" onPress={rescan} />
        <BigButton label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={[styles.flex, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  wide: { alignSelf: 'stretch' },
  buttons: { alignSelf: 'stretch', gap: 14, marginTop: 16 },
  muted: { fontSize: 19, color: colors.muted, textAlign: 'center' },
  question: { fontSize: 28, fontWeight: '700', color: colors.fg, textAlign: 'center' },
  amount: { fontSize: 72, fontWeight: '900', color: colors.fg, fontVariant: ['tabular-nums'] },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: 48, alignItems: 'center' },
  scanHintText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  success: { backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  tick: { fontSize: 140, fontWeight: '900', color: '#FFFFFF', lineHeight: 160 },
  successAmount: { fontSize: 64, fontWeight: '900', color: '#FFFFFF' },
  successText: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
});
