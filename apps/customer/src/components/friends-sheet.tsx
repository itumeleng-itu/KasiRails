import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BigButton, colors } from '@/components/ui';

const DURATION_MS = 260;

/** Bottom sheet that fades and slides up, offering to request from or pay a friend. */
export function FriendsSheet(props: { visible: boolean; onClose: () => void; onChoose: (mode: 'request' | 'pay') => void }) {
  const { visible, onClose, onChoose } = props;
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: DURATION_MS, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: DURATION_MS, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: 24 + insets.bottom, opacity: progress, transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Friends</Text>
        <BigButton label="Request from a friend" onPress={() => onChoose('request')} />
        <BigButton label="Pay money to a friend" variant="secondary" onPress={() => onChoose('pay')} />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 14,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#D0D0D0', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.fg, marginBottom: 4 },
});
