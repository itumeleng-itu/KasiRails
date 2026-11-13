import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/ui';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['extra', '0', 'back'],
];

/** PIN dots plus a number pad. `extra` is an optional bottom-left key (e.g. Face ID). */
export function PinPad(props: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  disabled?: boolean;
  extra?: { label: string; onPress: () => void };
}) {
  const { value, maxLength, onChange, disabled, extra } = props;

  const press = (key: string) => {
    if (disabled) return;
    if (key === 'back') onChange(value.slice(0, -1));
    else if (key === 'extra') extra?.onPress();
    else if (value.length < maxLength) onChange(value + key);
  };

  return (
    <View style={styles.container}>
      <View style={styles.dots} accessibilityLabel={`${value.length} of ${maxLength} digits entered`}>
        {Array.from({ length: maxLength }, (_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => {
            if (key === 'extra' && !extra) return <View key={key} style={styles.key} />;
            const label = key === 'back' ? '⌫' : key === 'extra' ? extra!.label : key;
            return (
              <Pressable
                key={key}
                onPress={() => press(key)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={key === 'back' ? 'Delete' : label}
                style={({ pressed }) => [styles.key, styles.keyBg, pressed && styles.pressed, disabled && styles.disabled]}>
                <Text style={[styles.keyText, key === 'extra' && styles.extraText]} adjustsFontSizeToFit numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, alignSelf: 'stretch' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 12 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.fg },
  dotFilled: { backgroundColor: colors.fg },
  row: { flexDirection: 'row', gap: 12 },
  key: { flex: 1, minHeight: 66, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  keyBg: { backgroundColor: colors.card },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  keyText: { fontSize: 30, fontWeight: '700', color: colors.fg },
  extraText: { fontSize: 16, fontWeight: '700' },
});
