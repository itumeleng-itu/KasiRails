import { StyleSheet, Text, View } from 'react-native';

import { BigButton, colors } from '@/components/ui';
import { formatRand } from '@/lib/format';

/** Full-screen green tick with the amount. */
export function Success(props: { zarCents: number; message: string; onDone: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.tick}>✓</Text>
      <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>
        {formatRand(props.zarCents)}
      </Text>
      <Text style={styles.message}>{props.message}</Text>
      <BigButton label="Done" variant="secondary" onPress={props.onDone} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  tick: { fontSize: 140, fontWeight: '900', color: '#FFFFFF', lineHeight: 160 },
  amount: { fontSize: 64, fontWeight: '900', color: '#FFFFFF' },
  message: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  button: { alignSelf: 'stretch' },
});
