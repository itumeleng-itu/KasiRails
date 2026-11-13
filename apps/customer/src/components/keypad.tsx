import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/ui';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];
const MAX_DIGITS = 7;

/** Applies one key press to a rand amount typed as text, e.g. "85.5". */
export function pressKey(entry: string, key: string): string {
  if (key === 'back') return entry.slice(0, -1);
  if (key === '.') return entry.includes('.') ? entry : (entry || '0') + '.';
  const dot = entry.indexOf('.');
  if (dot !== -1 && entry.length - dot > 2) return entry; // max 2 decimals
  if (entry.replace('.', '').length >= MAX_DIGITS) return entry;
  return (entry === '0' ? '' : entry) + key;
}

/** "85.5" -> 8550 */
export function entryToCents(entry: string): number {
  if (!entry || entry === '.') return 0;
  const [rands, cents = ''] = entry.split('.');
  return Number(rands || '0') * 100 + Number((cents + '00').slice(0, 2));
}

/** Number pad for rand amounts. */
export function Keypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <View style={styles.grid}>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? 'Delete' : key}
              onPress={() => onKey(key)}
              style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
              <Text style={styles.keyText}>{key === 'back' ? '⌫' : key}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 10, alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 10 },
  key: { flex: 1, minHeight: 56, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  keyText: { fontSize: 26, fontWeight: '700', color: colors.fg },
});
