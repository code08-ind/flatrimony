import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

interface ScreenProps {
  children: ReactNode;
  /**
   * Pinned below the scrolling content (e.g. an action button and the in-app keypad). It never
   * moves when a message appears above it, and stays reachable on short screens.
   */
  footer?: ReactNode;
  /** When it changes (a stepper's step), the content scrolls back to the top. */
  scrollKey?: string;
}

/** Light screen shell: matcha-milk background, 20 px side padding, safe areas (docs/06 §3.3). */
export function Screen({ children, footer, scrollKey }: ScreenProps) {
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [scrollKey]);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[styles.content, footer ? styles.contentWithFooter : null]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg.app },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.layout.screenPaddingMobile,
    paddingVertical: theme.space['4'],
    gap: theme.space['6'],
  },
  contentWithFooter: { gap: theme.space['4'], paddingBottom: theme.space['3'] },
  footer: {
    paddingHorizontal: theme.layout.screenPaddingMobile,
    paddingTop: theme.space['3'],
    paddingBottom: theme.space['4'],
    gap: theme.space['3'],
  },
});
