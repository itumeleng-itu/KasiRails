import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#FFFFFF',
  fg: '#111111',
  muted: '#5C5C5C',
  primary: '#FF7A00',
  card: '#F4F4F4',
  success: '#00A651',
  danger: '#C62828',
};

export function BigButton(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { label, onPress, variant = 'primary', disabled, busy, style } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.primary : styles.secondary,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {busy ? <ActivityIndicator color={colors.fg} size="large" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export function Message(props: { title: string; body?: string; tone?: 'danger' | 'muted' }) {
  return (
    <View style={styles.message}>
      <Text style={[styles.messageTitle, props.tone === 'danger' && { color: colors.danger }]}>{props.title}</Text>
      {props.body ? <Text style={styles.messageBody}>{props.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.bg, borderWidth: 3, borderColor: colors.fg },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  buttonText: { fontSize: 26, fontWeight: '800', color: colors.fg },
  message: { gap: 8, alignItems: 'center', paddingHorizontal: 8 },
  messageTitle: { fontSize: 26, fontWeight: '800', color: colors.fg, textAlign: 'center' },
  messageBody: { fontSize: 19, color: colors.muted, textAlign: 'center', lineHeight: 26 },
});
